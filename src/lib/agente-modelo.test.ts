import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  claveFaltante,
  claveFaltanteConRespaldo,
  correrTurnoAgente,
  esFalloDelServicio,
  esModeloOpenAI,
  modeloRespaldoPara,
  type EntornoModelos,
  type ResultadoTurno,
  type TurnoAgente,
} from "./agente-modelo";

const ENV_COMPLETO: EntornoModelos = {
  ANTHROPIC_API_KEY: "sk-ant-prueba",
  OPENAI_API_KEY: "sk-prueba",
  MODELO_RESPALDO: "gpt-5.6-sol",
};

function turnoDePrueba(alTexto: (f: string) => void = () => {}): TurnoAgente {
  return {
    modelo: "claude-sonnet-5",
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

describe("claveFaltante y modeloRespaldoPara", () => {
  it("cada proveedor exige su clave", () => {
    expect(esModeloOpenAI("gpt-5.6-sol")).toBe(true);
    expect(esModeloOpenAI("claude-sonnet-5")).toBe(false);
    expect(claveFaltante("gpt-5.6-sol", { OPENAI_API_KEY: "x" })).toBeNull();
    expect(claveFaltante("gpt-5.6-sol", {})).toBe("OPENAI_API_KEY");
    expect(claveFaltante("claude-sonnet-5", {})).toBe("ANTHROPIC_API_KEY");
  });

  it("hay respaldo solo con MODELO_RESPALDO distinto y con clave de su proveedor", () => {
    expect(modeloRespaldoPara("claude-sonnet-5", ENV_COMPLETO)).toBe("gpt-5.6-sol");
    expect(modeloRespaldoPara("claude-sonnet-5", { ...ENV_COMPLETO, MODELO_RESPALDO: "" })).toBeNull();
    expect(modeloRespaldoPara("claude-sonnet-5", { ...ENV_COMPLETO, MODELO_RESPALDO: undefined })).toBeNull();
    expect(modeloRespaldoPara("gpt-5.6-sol", ENV_COMPLETO)).toBeNull();
    expect(modeloRespaldoPara("claude-sonnet-5", { ...ENV_COMPLETO, OPENAI_API_KEY: "" })).toBeNull();
    expect(modeloRespaldoPara("gpt-5.6-sol", { ...ENV_COMPLETO, MODELO_RESPALDO: "claude-opus-5" })).toBe("claude-opus-5");
  });

  it("el portero de las rutas deja pasar si el respaldo puede tomar el turno", () => {
    const sinAnthropic: EntornoModelos = { ...ENV_COMPLETO, ANTHROPIC_API_KEY: undefined };
    expect(claveFaltanteConRespaldo("claude-sonnet-5", ENV_COMPLETO)).toBeNull();
    expect(claveFaltanteConRespaldo("claude-sonnet-5", sinAnthropic)).toBeNull();
    // Sin ninguna de las dos claves no hay con qué contestar: se nombra la del principal.
    expect(claveFaltanteConRespaldo("claude-sonnet-5", { MODELO_RESPALDO: "gpt-5.6-sol" })).toBe("ANTHROPIC_API_KEY");
    expect(claveFaltanteConRespaldo("claude-sonnet-5", { ANTHROPIC_API_KEY: undefined })).toBe("ANTHROPIC_API_KEY");
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

describe("correrTurnoAgente con respaldo", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("si el principal falla por el servicio antes de contestar, repite el turno con el respaldo", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const ejecutar = vi
      .fn<(t: TurnoAgente) => Promise<ResultadoTurno>>()
      .mockRejectedValueOnce(errorAnthropic(529, "Overloaded"))
      .mockImplementationOnce(async (t) => resultado(t.modelo, "desde el respaldo"));

    const salida = await correrTurnoAgente(turnoDePrueba(), { respaldo: "gpt-5.6-sol", ejecutar, env: ENV_COMPLETO });

    expect(salida.modelo).toBe("gpt-5.6-sol");
    expect(ejecutar).toHaveBeenCalledTimes(2);
    expect(ejecutar.mock.calls[0][0].modelo).toBe("claude-sonnet-5");
    expect(ejecutar.mock.calls[1][0].modelo).toBe("gpt-5.6-sol");
    expect(ejecutar.mock.calls[1][0].mensajes).toEqual(turnoDePrueba().mensajes);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("se repite el turno con gpt-5.6-sol"));
  });

  it("un error de nuestra petición (400) no se reintenta", async () => {
    const ejecutar = vi.fn<(t: TurnoAgente) => Promise<ResultadoTurno>>().mockRejectedValue(errorAnthropic(400));

    await expect(correrTurnoAgente(turnoDePrueba(), { respaldo: "gpt-5.6-sol", ejecutar, env: ENV_COMPLETO })).rejects.toMatchObject({
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
      correrTurnoAgente(turnoDePrueba((f) => recibido.push(f)), { respaldo: "gpt-5.6-sol", ejecutar, env: ENV_COMPLETO })
    ).rejects.toBeInstanceOf(Anthropic.APIConnectionError);
    expect(ejecutar).toHaveBeenCalledTimes(1);
    expect(recibido).toEqual(["Hola, "]);
  });

  it("sin respaldo configurado el error sube tal cual", async () => {
    const ejecutar = vi.fn<(t: TurnoAgente) => Promise<ResultadoTurno>>().mockRejectedValue(errorAnthropic(529));

    await expect(correrTurnoAgente(turnoDePrueba(), { respaldo: null, ejecutar, env: ENV_COMPLETO })).rejects.toMatchObject({ status: 529 });
    expect(ejecutar).toHaveBeenCalledTimes(1);
  });

  it("si el respaldo también falla, sube el error del respaldo y queda en el log", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const registro = vi.spyOn(console, "error").mockImplementation(() => {});
    const ejecutar = vi
      .fn<(t: TurnoAgente) => Promise<ResultadoTurno>>()
      .mockRejectedValueOnce(errorAnthropic(529))
      .mockRejectedValueOnce(OpenAI.APIError.generate(503, {}, "down", new Headers()));

    await expect(correrTurnoAgente(turnoDePrueba(), { respaldo: "gpt-5.6-sol", ejecutar, env: ENV_COMPLETO })).rejects.toMatchObject({
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

    const salida = await correrTurnoAgente(turnoDePrueba((f) => recibido.push(f)), { respaldo: "gpt-5.6-sol", ejecutar, env: ENV_COMPLETO });

    expect(salida.modelo).toBe("claude-sonnet-5");
    expect(recibido).toEqual(["todo ", "bien"]);
    expect(ejecutar).toHaveBeenCalledTimes(1);
  });

  it("sin clave del principal arranca directo en el respaldo, sin gastar un intento seguro de fallar", async () => {
    const ejecutar = vi
      .fn<(t: TurnoAgente) => Promise<ResultadoTurno>>()
      .mockImplementation(async (t) => resultado(t.modelo));

    const salida = await correrTurnoAgente(turnoDePrueba(), {
      ejecutar,
      env: { ...ENV_COMPLETO, ANTHROPIC_API_KEY: undefined },
    });

    expect(salida.modelo).toBe("gpt-5.6-sol");
    expect(ejecutar).toHaveBeenCalledTimes(1);
    expect(ejecutar.mock.calls[0]?.[0].modelo).toBe("gpt-5.6-sol");
  });
});
