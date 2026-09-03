import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { apiKeyValida, comparaSecretoSeguro } from "./api-key";

function peticion(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/mostrador/pedidos", { headers });
}

describe("comparaSecretoSeguro", () => {
  it("acepta iguales y rechaza distintos o de largo diferente", () => {
    expect(comparaSecretoSeguro("abc123", "abc123")).toBe(true);
    expect(comparaSecretoSeguro("abc124", "abc123")).toBe(false);
    expect(comparaSecretoSeguro("abc12", "abc123")).toBe(false);
    expect(comparaSecretoSeguro("", "abc123")).toBe(false);
  });
});

describe("apiKeyValida", () => {
  const original = { ...process.env };

  beforeEach(() => {
    process.env.MOSTRADOR_API_KEY = "mostrador-secreta";
    process.env.WHATSAPP_API_KEY = "whatsapp-secreta";
  });

  afterEach(() => {
    process.env = { ...original };
  });

  it("acepta la key correcta en X-API-Key", () => {
    expect(apiKeyValida(peticion({ "X-API-Key": "mostrador-secreta" }), "MOSTRADOR_API_KEY")).toBe(true);
    expect(apiKeyValida(peticion({ "x-api-key": " mostrador-secreta " }), "MOSTRADOR_API_KEY")).toBe(true);
  });

  it("cada variable valida solo su propia key", () => {
    expect(apiKeyValida(peticion({ "X-API-Key": "whatsapp-secreta" }), "MOSTRADOR_API_KEY")).toBe(false);
    expect(apiKeyValida(peticion({ "X-API-Key": "whatsapp-secreta" }), "WHATSAPP_API_KEY")).toBe(true);
  });

  it("ignora Authorization: ahí va el token del vendedor, no la key", () => {
    expect(
      apiKeyValida(peticion({ Authorization: "Bearer mostrador-secreta" }), "MOSTRADOR_API_KEY")
    ).toBe(false);
  });

  it("rechaza header ausente, vacío o incorrecto", () => {
    expect(apiKeyValida(peticion({}), "MOSTRADOR_API_KEY")).toBe(false);
    expect(apiKeyValida(peticion({ "X-API-Key": "" }), "MOSTRADOR_API_KEY")).toBe(false);
    expect(apiKeyValida(peticion({ "X-API-Key": "mostrador-secret" }), "MOSTRADOR_API_KEY")).toBe(false);
  });

  it("sin key configurada la puerta queda cerrada", () => {
    delete process.env.MOSTRADOR_API_KEY;
    expect(apiKeyValida(peticion({ "X-API-Key": "" }), "MOSTRADOR_API_KEY")).toBe(false);
    expect(apiKeyValida(peticion({ "X-API-Key": "lo-que-sea" }), "MOSTRADOR_API_KEY")).toBe(false);
  });
});
