import { afterEach, describe, expect, it, vi } from "vitest";
import { AxonError } from "./axon";
import { respuestaErrorAxon } from "./axon-http";

describe("respuestaErrorAxon", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sin configurar responde 503 con la bandera para la interfaz", async () => {
    const res = respuestaErrorAxon(
      new AxonError("falta configurar AXON_API_KEY en el servidor", "sin_configurar"),
      "consultar el saldo"
    );

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: "No se pudo consultar el saldo: falta configurar AXON_API_KEY en el servidor",
      sinConfigurar: true,
    });
  });

  it("el 429 de Axon se pasa tal cual y cualquier otro fallo de Axon es 502", async () => {
    const limite = respuestaErrorAxon(
      new AxonError("Axon Logic está limitando las peticiones (HTTP 429)", "http", 429),
      "consultar el saldo"
    );
    expect(limite.status).toBe(429);
    expect((await limite.json()).sinConfigurar).toBe(false);

    const caido = respuestaErrorAxon(
      new AxonError("Axon Logic tuvo un error (HTTP 500)", "http", 500),
      "iniciar la compra"
    );
    expect(caido.status).toBe(502);
    expect((await caido.json()).error).toBe("No se pudo iniciar la compra: Axon Logic tuvo un error (HTTP 500)");

    const timeout = respuestaErrorAxon(new AxonError("Axon Logic no respondió a tiempo", "timeout"), "x");
    expect(timeout.status).toBe(502);
  });

  it("un error ajeno a Axon no filtra detalles técnicos al navegador", async () => {
    const registro = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = respuestaErrorAxon(new Error("ECONNRESET en 10.0.0.5"), "iniciar la compra");

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "No se pudo iniciar la compra" });
    expect(registro).toHaveBeenCalledTimes(1);
  });
});
