import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { firmaPedido, firmaValida, urlPdfPedido } from "./pedido-enlace";

describe("enlace firmado al PDF del pedido", () => {
  beforeEach(() => {
    vi.stubEnv("JWT_SECRET", "secreto-de-prueba");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("la firma es hex de 32, estable y distinta por pedido", () => {
    const firma = firmaPedido(21);
    expect(firma).toMatch(/^[0-9a-f]{32}$/);
    expect(firmaPedido(21)).toBe(firma);
    expect(firmaPedido(22)).not.toBe(firma);
  });

  it("cambia con el secreto: una firma de otro servidor no abre aquí", () => {
    const conUno = firmaPedido(21);
    vi.stubEnv("JWT_SECRET", "otro-secreto");
    expect(firmaPedido(21)).not.toBe(conUno);
    expect(firmaValida(21, conUno ?? "")).toBe(false);
  });

  it("valida la firma correcta y rechaza las demás sin tronar", () => {
    const firma = firmaPedido(21) ?? "";
    expect(firmaValida(21, firma)).toBe(true);
    expect(firmaValida(22, firma)).toBe(false);
    expect(firmaValida(21, firma.slice(0, 31) + (firma.endsWith("0") ? "1" : "0"))).toBe(false);
    expect(firmaValida(21, "")).toBe(false);
    expect(firmaValida(21, "x".repeat(32))).toBe(false);
    expect(firmaValida(21, firma + "0")).toBe(false);
  });

  it("arma la URL pública con la firma y sin diagonales repetidas", () => {
    expect(urlPdfPedido("https://vidaurri.hlsistemas.com/", 21)).toBe(
      `https://vidaurri.hlsistemas.com/api/pedidos/21/pdf?f=${firmaPedido(21)}`
    );
    expect(urlPdfPedido("", 21)).toBeNull();
  });

  it("sin JWT_SECRET no hay firma ni enlace, y nada valida", () => {
    vi.stubEnv("JWT_SECRET", "");
    expect(firmaPedido(21)).toBeNull();
    expect(urlPdfPedido("https://x", 21)).toBeNull();
    expect(firmaValida(21, "a".repeat(32))).toBe(false);
  });

  it("ids inválidos no se firman", () => {
    expect(firmaPedido(0)).toBeNull();
    expect(firmaPedido(-3)).toBeNull();
    expect(firmaPedido(2.5)).toBeNull();
  });
});
