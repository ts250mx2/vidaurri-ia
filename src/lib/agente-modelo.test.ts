import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ERROR_SIN_IA,
  correrTurnoAgente,
  credencialDeAgente,
  credencialParaRuta,
  esFalloDelServicio,
  proveedorSoportado,
  type CredencialIA,
  type ResultadoTurno,
  type TurnoAgente,
} from "./agente-modelo";
import { HlClienteError, type AgenteHl, type EntornoHl, type LlaveIA } from "./hl-cliente";

const PRINCIPAL: CredencialIA = { proveedor: "claude", modelo: "claude-sonnet-5", llave: "sk-ant-prueba" };
const RESPALDO: CredencialIA = { proveedor: "openai", modelo: "gpt-5.6-sol", llave: "sk-prueba" };

function turnoDePrueba(alTexto: (f: string) => void = () => {}): TurnoAgente {
  return {
    ...PRINCIPAL,
    sistema: "Eres una prueba",
    herramientas: [],
    mensajes: [{ role: "user", content: "hola" }],
    maxTokens: 100,
    alTexto,
  };
}

function resultado(modelo: string, texto = "listo"): ResultadoTurno {
  return { contenido: [{ type: "text", text: texto, citations: [] } as Anthropic.ContentBlock], usos: [], modelo };
}

function errorAnthropic(status: number, mensaje = "falla"): unknown {
  return Anthropic.APIError.generate(status, { type: "error", error: { type: "x", message: mensaje } }, mensaje, new Headers());
}

function llaveHl(parcial: Partial<LlaveIA> = {}): LlaveIA {
  return {
    uuid: "66666666-7777-4888-9999-aaaaaaaaaaaa",
    agente: "Asistente VICO",
    proveedor: "claude",
    modelo: "claude-sonnet-5",
    llave: "sk-ant-prueba",
    caducidad: null,
    ...parcial,
  };
}

const LLAVE_RESPALDO = llaveHl({ agente: "Respaldo Vidaurri", proveedor: "openai", modelo: "gpt-5.6-sol", llave: "sk-prueba" });

/** HL de mentiras: por agente, la llave que da o el error con que contesta. */
function hlDoble(porAgente: Partial<Record<AgenteHl, LlaveIA | Error>>) {
  return vi.fn(async (agente: AgenteHl) => {
    const valor = porAgente[agente];
    if (valor instanceof Error) throw valor;
    if (!valor) throw new HlClienteError("Agente no encontrado", 404);
    return valor;
  });
}

const SIN_RESPALDO: EntornoHl = { HL_AGENTE_VIDA: "uuid-vida", HL_AGENTE_VICO: "uuid-vico" };
const CON_RESPALDO: EntornoHl = { ...SIN_RESPALDO, HL_AGENTE_RESPALDO: "uuid-respaldo" };

describe("credencial de cada agente desde HL", () => {
  it("claude y openai se corren; gemini u otro no", () => {
    expect(proveedorSoportado("claude")).toBe("claude");
    expect(proveedorSoportado(" OpenAI ")).toBe("openai");
    expect(proveedorSoportado("gemini")).toBeNull();
    expect(proveedorSoportado("otro")).toBeNull();
  });

  it("arma la credencial del agente con el proveedor, el modelo y la llave que manda HL", async () => {
    const obtener = vi.fn(async () => llaveHl());

    const credencial = await credencialDeAgente("vico", obtener);

    expect(credencial).toEqual(PRINCIPAL);
    expect(obtener).toHaveBeenCalledWith("vico");
  });

  it("un proveedor que no se sabe correr ni se intenta: sube HlClienteError", async () => {
    const obtener = vi.fn(async () => llaveHl({ proveedor: "gemini", modelo: "gemini-3" }));

    await expect(credencialDeAgente("vida", obtener)).rejects.toBeInstanceOf(HlClienteError);
  });
});

describe("credencialParaRuta", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sin HL_AGENTE_RESPALDO solo se pide la llave del agente y no hay respaldo", async () => {
    const obtener = hlDoble({ vico: llaveHl() });

    const ruta = await credencialParaRuta("vico", { obtener, env: SIN_RESPALDO });

    expect(ruta).toEqual({ ok: true, credencial: { ...PRINCIPAL, respaldo: null } });
    expect(obtener).toHaveBeenCalledTimes(1);
  });

  it("con respaldo configurado, la credencial del agente lleva adentro la de respaldo", async () => {
    const obtener = hlDoble({ vico: llaveHl(), respaldo: LLAVE_RESPALDO });

    const ruta = await credencialParaRuta("vico", { obtener, env: CON_RESPALDO });

    expect(ruta).toEqual({ ok: true, credencial: { ...PRINCIPAL, respaldo: RESPALDO } });
  });

  it("si HL no da la de respaldo, el agente corre igual sin respaldo y el motivo queda en el log", async () => {
    const registro = vi.spyOn(console, "error").mockImplementation(() => {});
    const obtener = hlDoble({ vico: llaveHl() });

    const ruta = await credencialParaRuta("vico", { obtener, env: CON_RESPALDO });

    expect(ruta).toEqual({ ok: true, credencial: { ...PRINCIPAL, respaldo: null } });
    expect(registro).toHaveBeenCalledWith(expect.stringContaining("respaldo"), expect.any(HlClienteError));
  });

  it("si HL no da la del agente (llave caducada) pero sí la de respaldo, el agente corre con la de respaldo", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const obtener = hlDoble({
      vida: new HlClienteError("La llave del agente ya caduco", 403),
      respaldo: LLAVE_RESPALDO,
    });

    const ruta = await credencialParaRuta("vida", { obtener, env: CON_RESPALDO });

    expect(ruta).toEqual({ ok: true, credencial: { ...RESPALDO, respaldo: null } });
  });

  it("sin la del agente ni la de respaldo, la ruta recibe un mensaje presentable y no el detalle", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const obtener = hlDoble({ vida: new HlClienteError("IP no autorizada", 403) });

    const ruta = await credencialParaRuta("vida", { obtener, env: CON_RESPALDO });

    expect(ruta).toEqual({ ok: false, error: ERROR_SIN_IA });
  });

  it("un respaldo idéntico al principal no sirve de nada: se descarta", async () => {
    const obtener = hlDoble({ vico: llaveHl(), respaldo: llaveHl({ agente: "Respaldo Vidaurri" }) });

    const ruta = await credencialParaRuta("vico", { obtener, env: CON_RESPALDO });

    expect(ruta).toEqual({ ok: true, credencial: { ...PRINCIPAL, respaldo: null } });
  });
});

describe("esFalloDelServicio", () => {
  it("sin conexión, timeout, 429 y 5xx (529 incluido) son del servicio", () => {
    expect(esFalloDelServicio(new Anthropic.APIConnectionError({ message: "ECONNREFUSED" }))).toBe(true);
    expect(esFalloDelServicio(new Anthropic.APIConnectionTimeoutError())).toBe(true);
    expect(esFalloDelServicio(new OpenAI.APIConnectionError({ message: "ECONNREFUSED" }))).toBe(true);
    expect(esFalloDelServicio(errorAnthropic(408))).toBe(true);
    expect(esFalloDelServicio(errorAnthropic(409))).toBe(true);
    expect(esFalloDelServicio(errorAnthropic(429))).toBe(true);
    expect(esFalloDelServicio(errorAnthropic(500))).toBe(true);
    expect(esFalloDelServicio(errorAnthropic(529, "Overloaded"))).toBe(true);
    expect(esFalloDelServicio(OpenAI.APIError.generate(503, {}, "down", new Headers()))).toBe(true);
  });

  it("la llave inválida (401) y la cuenta sin saldo o sin permiso (403) también van al respaldo", () => {
    expect(esFalloDelServicio(errorAnthropic(401))).toBe(true);
    expect(esFalloDelServicio(errorAnthropic(403, "billing_error"))).toBe(true);
  });

  it("un 400 o un 404 es cosa de la petición: repetirla en otro modelo daría lo mismo", () => {
    expect(esFalloDelServicio(errorAnthropic(400))).toBe(false);
    expect(esFalloDelServicio(errorAnthropic(404))).toBe(false);
    expect(esFalloDelServicio(new Error("cualquier otra cosa"))).toBe(false);
    expect(esFalloDelServicio("texto")).toBe(false);
  });
});

describe("correrTurnoAgente", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sin respaldo corre una sola vez con la credencial del agente y el error sube tal cual", async () => {
    const ejecutar = vi.fn<(t: TurnoAgente) => Promise<ResultadoTurno>>().mockRejectedValue(errorAnthropic(529));

    await expect(correrTurnoAgente(turnoDePrueba(), { ejecutar })).rejects.toMatchObject({ status: 529 });
    expect(ejecutar).toHaveBeenCalledTimes(1);
    expect(ejecutar.mock.calls[0][0]).toMatchObject(PRINCIPAL);
  });

  it("si el principal falla por el servicio antes de contestar, repite el turno con la credencial de respaldo", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const ejecutar = vi
      .fn<(t: TurnoAgente) => Promise<ResultadoTurno>>()
      .mockRejectedValueOnce(errorAnthropic(529, "Overloaded"))
      .mockImplementationOnce(async (t) => resultado(t.modelo, "desde el respaldo"));

    const salida = await correrTurnoAgente(turnoDePrueba(), { respaldo: RESPALDO, ejecutar });

    expect(salida.modelo).toBe("gpt-5.6-sol");
    expect(ejecutar).toHaveBeenCalledTimes(2);
    expect(ejecutar.mock.calls[0][0]).toMatchObject(PRINCIPAL);
    // El respaldo corre con SU proveedor y SU llave, no con los del principal.
    expect(ejecutar.mock.calls[1][0]).toMatchObject(RESPALDO);
    expect(ejecutar.mock.calls[1][0].mensajes).toEqual(turnoDePrueba().mensajes);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("se repite el turno con gpt-5.6-sol"));
  });

  it("toma el respaldo que trae la credencial del turno, y el respaldo no encadena otro", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const ejecutar = vi
      .fn<(t: TurnoAgente) => Promise<ResultadoTurno>>()
      .mockRejectedValueOnce(errorAnthropic(401))
      .mockImplementationOnce(async (t) => resultado(t.modelo));

    const salida = await correrTurnoAgente({ ...turnoDePrueba(), respaldo: RESPALDO }, { ejecutar });

    expect(salida.modelo).toBe("gpt-5.6-sol");
    expect(ejecutar.mock.calls[1][0]).toMatchObject({ ...RESPALDO, respaldo: null });
  });

  it("un error de nuestra petición (400) no se reintenta", async () => {
    const ejecutar = vi.fn<(t: TurnoAgente) => Promise<ResultadoTurno>>().mockRejectedValue(errorAnthropic(400));

    await expect(correrTurnoAgente(turnoDePrueba(), { respaldo: RESPALDO, ejecutar })).rejects.toMatchObject({
      status: 400,
    });
    expect(ejecutar).toHaveBeenCalledTimes(1);
  });

  it("si ya había texto emitido no se reintenta: el usuario lo vería dos veces", async () => {
    const recibido: string[] = [];
    const ejecutar = vi.fn<(t: TurnoAgente) => Promise<ResultadoTurno>>().mockImplementation(async (t) => {
      t.alTexto("Hola, ");
      throw new Anthropic.APIConnectionError({ message: "se cortó" });
    });

    await expect(
      correrTurnoAgente(turnoDePrueba((f) => recibido.push(f)), { respaldo: RESPALDO, ejecutar })
    ).rejects.toBeInstanceOf(Anthropic.APIConnectionError);
    expect(ejecutar).toHaveBeenCalledTimes(1);
    expect(recibido).toEqual(["Hola, "]);
  });

  it("si el respaldo también falla, sube el error del respaldo y queda en el log", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const registro = vi.spyOn(console, "error").mockImplementation(() => {});
    const ejecutar = vi
      .fn<(t: TurnoAgente) => Promise<ResultadoTurno>>()
      .mockRejectedValueOnce(errorAnthropic(529))
      .mockRejectedValueOnce(OpenAI.APIError.generate(503, {}, "down", new Headers()));

    await expect(correrTurnoAgente(turnoDePrueba(), { respaldo: RESPALDO, ejecutar })).rejects.toMatchObject({
      status: 503,
    });
    expect(registro).toHaveBeenCalledWith(expect.stringContaining("también falló"));
  });

  it("cuando el principal contesta bien, el respaldo ni se toca y el texto llega tal cual", async () => {
    const recibido: string[] = [];
    const ejecutar = vi.fn<(t: TurnoAgente) => Promise<ResultadoTurno>>().mockImplementation(async (t) => {
      t.alTexto("todo ");
      t.alTexto("bien");
      return resultado(t.modelo);
    });

    const salida = await correrTurnoAgente(turnoDePrueba((f) => recibido.push(f)), { respaldo: RESPALDO, ejecutar });

    expect(salida.modelo).toBe("claude-sonnet-5");
    expect(recibido).toEqual(["todo ", "bien"]);
    expect(ejecutar).toHaveBeenCalledTimes(1);
  });
});
