import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ERROR_SIN_IA,
  correrTurnoAgente,
  credencialDeAgente,
  credencialParaRuta,
  esCambioDeProveedor,
  esFalloDelServicio,
  proveedorSoportado,
  type CredencialIA,
  type ResultadoTurno,
  type TurnoAgente,
} from "./agente-modelo";
import { HlClienteError, type AgenteHl, type AgenteIA, type EntornoHl } from "./hl-cliente";

const UUID_VIDA = "11111111-2222-4333-8444-555555555555";
const UUID_VICO = "66666666-7777-4888-9999-aaaaaaaaaaaa";
const UUID_RESPALDO = "0b7e5f3c-1d2a-4c9e-8f00-6a5b4c3d2e1f";
const HL_URL = "http://hl.prueba:3056";
const HL_KEY = `hl_${"a".repeat(48)}`;

const SIN_RESPALDO: EntornoHl = {
  HL_URL,
  HL_API_KEY: HL_KEY,
  HL_AGENTE_VIDA: UUID_VIDA,
  HL_AGENTE_VICO: UUID_VICO,
};
const CON_RESPALDO: EntornoHl = { ...SIN_RESPALDO, HL_AGENTE_RESPALDO: UUID_RESPALDO };

const CABECERAS = { "X-HL-Key": HL_KEY };
const PRINCIPAL: CredencialIA = {
  proveedor: "claude",
  modelo: "claude-sonnet-5",
  baseURL: `${HL_URL}/api/ws/proxy/${UUID_VICO}`,
  headers: CABECERAS,
  agente: "vico",
};
const RESPALDO: CredencialIA = {
  proveedor: "openai",
  modelo: "gpt-5.6-sol",
  baseURL: `${HL_URL}/api/ws/proxy/${UUID_RESPALDO}`,
  headers: CABECERAS,
  agente: "respaldo",
};

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

function agenteHl(parcial: Partial<AgenteIA> = {}): AgenteIA {
  return {
    uuid: UUID_VICO,
    nombre: "Asistente VICO",
    proveedor: "claude",
    modelo: "claude-sonnet-5",
    caducidad: null,
    ...parcial,
  };
}

const AGENTE_RESPALDO = agenteHl({
  uuid: UUID_RESPALDO,
  nombre: "Respaldo Vidaurri",
  proveedor: "openai",
  modelo: "gpt-5.6-sol",
});

/** HL de mentiras: por agente, lo que responde o el error con que contesta. */
function hlDoble(porAgente: Partial<Record<AgenteHl, AgenteIA | Error>>) {
  return vi.fn(async (agente: AgenteHl) => {
    const valor = porAgente[agente];
    if (valor instanceof Error) throw valor;
    if (!valor) throw new HlClienteError("Agente no encontrado", 404);
    return valor;
  });
}

describe("credencial de cada agente desde HL", () => {
  it("claude y openai se corren; gemini u otro no", () => {
    expect(proveedorSoportado("claude")).toBe("claude");
    expect(proveedorSoportado(" OpenAI ")).toBe("openai");
    expect(proveedorSoportado("gemini")).toBeNull();
    expect(proveedorSoportado("otro")).toBeNull();
  });

  it("la credencial lleva el proveedor y el modelo de HL, y la entrada al proxy del agente", async () => {
    const obtener = hlDoble({ vico: agenteHl() });

    const credencial = await credencialDeAgente("vico", { obtener, env: SIN_RESPALDO });

    expect(credencial).toEqual(PRINCIPAL);
    // La llave del proveedor no aparece por ningún lado: la pone HL en el proxy.
    expect(JSON.stringify(credencial)).not.toContain("sk-");
  });

  it("un proveedor que no se sabe correr ni se intenta: sube HlClienteError", async () => {
    const obtener = hlDoble({ vida: agenteHl({ proveedor: "gemini", modelo: "gemini-3" }) });

    await expect(credencialDeAgente("vida", { obtener, env: SIN_RESPALDO })).rejects.toBeInstanceOf(HlClienteError);
  });
});

describe("credencialParaRuta", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sin HL_AGENTE_RESPALDO solo se pregunta por el agente y no hay respaldo", async () => {
    const obtener = hlDoble({ vico: agenteHl() });

    const ruta = await credencialParaRuta("vico", { obtener, env: SIN_RESPALDO });

    expect(ruta).toEqual({ ok: true, credencial: { ...PRINCIPAL, respaldo: null } });
    expect(obtener).toHaveBeenCalledTimes(1);
  });

  it("con respaldo configurado, la credencial del agente lleva adentro la de respaldo", async () => {
    const obtener = hlDoble({ vico: agenteHl(), respaldo: AGENTE_RESPALDO });

    const ruta = await credencialParaRuta("vico", { obtener, env: CON_RESPALDO });

    expect(ruta).toEqual({ ok: true, credencial: { ...PRINCIPAL, respaldo: RESPALDO } });
  });

  it("si HL no da el de respaldo, el agente corre igual sin respaldo y el motivo queda en el log", async () => {
    const registro = vi.spyOn(console, "error").mockImplementation(() => {});
    const obtener = hlDoble({ vico: agenteHl() });

    const ruta = await credencialParaRuta("vico", { obtener, env: CON_RESPALDO });

    expect(ruta).toEqual({ ok: true, credencial: { ...PRINCIPAL, respaldo: null } });
    expect(registro).toHaveBeenCalledWith(expect.stringContaining("respaldo"), expect.any(HlClienteError));
  });

  it("si HL no da el del agente (llave caducada) pero sí el de respaldo, el agente corre con ese", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const obtener = hlDoble({
      vida: new HlClienteError("La llave del agente ya caduco", 403),
      respaldo: AGENTE_RESPALDO,
    });

    const ruta = await credencialParaRuta("vida", { obtener, env: CON_RESPALDO });

    expect(ruta).toEqual({ ok: true, credencial: { ...RESPALDO, respaldo: null } });
  });

  it("sin el del agente ni el de respaldo, la ruta recibe un mensaje presentable y no el detalle", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const obtener = hlDoble({ vida: new HlClienteError("IP no autorizada", 403) });

    const ruta = await credencialParaRuta("vida", { obtener, env: CON_RESPALDO });

    expect(ruta).toEqual({ ok: false, error: ERROR_SIN_IA });
  });

  it("si HL_AGENTE_RESPALDO apunta al mismo agente, no sirve de respaldo: se descarta", async () => {
    const obtener = hlDoble({ vico: agenteHl(), respaldo: agenteHl() });
    const mismoAgente: EntornoHl = { ...SIN_RESPALDO, HL_AGENTE_RESPALDO: UUID_VICO };

    const ruta = await credencialParaRuta("vico", { obtener, env: mismoAgente });

    expect(ruta.ok && ruta.credencial.respaldo).toBeNull();
  });

  it("otro agente de HL con el mismo proveedor y modelo sí sirve: detrás hay otra llave", async () => {
    const obtener = hlDoble({
      vico: agenteHl(),
      respaldo: agenteHl({ uuid: UUID_RESPALDO, nombre: "Respaldo Vidaurri" }),
    });

    const ruta = await credencialParaRuta("vico", { obtener, env: CON_RESPALDO });

    expect(ruta.ok && ruta.credencial.respaldo).toMatchObject({
      modelo: "claude-sonnet-5",
      baseURL: `${HL_URL}/api/ws/proxy/${UUID_RESPALDO}`,
    });
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

/** Rechazo del proxy de HL cuando la app llamó con el SDK del proveedor anterior. */
function errorProveedorCambiado(): unknown {
  return OpenAI.APIError.generate(
    422,
    { error: "El agente ahora corre con OpenAI" },
    "El agente ahora corre con OpenAI",
    new Headers({ "x-hl-error": "PROVEEDOR_CAMBIADO" })
  );
}

describe("esCambioDeProveedor", () => {
  it("es el 422 de HL con X-HL-Error: PROVEEDOR_CAMBIADO, venga del SDK que venga", () => {
    expect(esCambioDeProveedor(errorProveedorCambiado())).toBe(true);
    const deAnthropic = Anthropic.APIError.generate(
      422,
      { type: "error", error: { type: "x", message: "cambió" } },
      "cambió",
      new Headers({ "X-HL-Error": "PROVEEDOR_CAMBIADO" })
    );
    expect(esCambioDeProveedor(deAnthropic)).toBe(true);
  });

  it("un 422 sin ese header es otra cosa (petición inválida del proveedor) y no lo es un 404", () => {
    expect(esCambioDeProveedor(OpenAI.APIError.generate(422, {}, "invalid", new Headers()))).toBe(false);
    expect(esCambioDeProveedor(errorAnthropic(404))).toBe(false);
    expect(esCambioDeProveedor(new Error("x"))).toBe(false);
  });
});

describe("correrTurnoAgente", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("si HL avisa que el agente cambió de proveedor, refresca la credencial y repite el turno con el SDK nuevo", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const nueva: CredencialIA = { ...PRINCIPAL, proveedor: "openai", modelo: "gpt-5.6-sol", agente: "vida" };
    const refrescar = vi.fn(async () => nueva);
    const ejecutar = vi
      .fn<(t: TurnoAgente) => Promise<ResultadoTurno>>()
      .mockRejectedValueOnce(errorProveedorCambiado())
      .mockImplementationOnce(async (t) => resultado(t.modelo, "ya con openai"));

    const salida = await correrTurnoAgente({ ...turnoDePrueba(), agente: "vida", respaldo: RESPALDO }, { ejecutar, refrescar });

    expect(refrescar).toHaveBeenCalledWith("vida");
    expect(salida.modelo).toBe("gpt-5.6-sol");
    expect(ejecutar).toHaveBeenCalledTimes(2);
    // Se repite con el proveedor nuevo del MISMO agente, no con el respaldo, y con la misma conversación.
    expect(ejecutar.mock.calls[1][0]).toMatchObject({ proveedor: "openai", modelo: "gpt-5.6-sol", baseURL: PRINCIPAL.baseURL, respaldo: null });
    expect(ejecutar.mock.calls[1][0].mensajes).toEqual(turnoDePrueba().mensajes);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("ahora corre con openai / gpt-5.6-sol"));
  });

  it("sin saber de qué agente salió la credencial, el aviso de cambio de proveedor sube tal cual", async () => {
    const refrescar = vi.fn();
    const ejecutar = vi.fn<(t: TurnoAgente) => Promise<ResultadoTurno>>().mockRejectedValue(errorProveedorCambiado());

    await expect(correrTurnoAgente({ ...turnoDePrueba(), agente: undefined }, { ejecutar, refrescar })).rejects.toMatchObject({ status: 422 });
    expect(refrescar).not.toHaveBeenCalled();
    expect(ejecutar).toHaveBeenCalledTimes(1);
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
    // El respaldo corre con SU proveedor y SU entrada al proxy, no con las del principal.
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
