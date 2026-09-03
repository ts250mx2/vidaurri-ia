import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AxonError } from "./axon";
import {
  consultarSaldoAxon,
  iniciarCheckoutAxon,
  interpretarCheckout,
  interpretarPacks,
  interpretarSaldo,
  leerPackId,
  limpiarCacheAxon,
  listarPacksAxon,
} from "./axon-creditos";

// Respuestas tal como las documenta la guía de integración de Axon (v1.0).
const SALDO_AXON = {
  balance: 1247,
  lifetime_credits: 5000,
  consumed_last_30d: 340,
  daily_burn_rate: 11.3,
  estimated_days_remaining: 110,
  updated_at: "2026-09-01T15:23:11.421Z",
};

const PACKS_AXON = {
  packs: [
    { id: "pack_500", name: "Pack 500", tokens: 500, price_mxn: 1250, price_per_token_mxn: 2.5, highlight: false },
    { id: "pack_1500", name: "Pack 1,500", tokens: 1500, price_mxn: 3500, highlight: true },
  ],
  currency: "MXN",
};

const CHECKOUT_AXON = {
  checkout_url: "https://checkout.stripe.com/c/pay/cs_live_123",
  pack: { id: "pack_1500", name: "Pack 1,500", tokens: 1500, price_mxn: 3500 },
  expires_in_minutes: 30,
};

function respuesta(status: number, cuerpo?: unknown, crudo?: string): Response {
  const texto = crudo ?? (cuerpo === undefined ? null : JSON.stringify(cuerpo));
  return new Response(texto, { status });
}

describe("interpretarSaldo", () => {
  it("traduce los campos de Axon", () => {
    expect(interpretarSaldo(SALDO_AXON)).toEqual({
      saldo: 1247,
      creditosHistoricos: 5000,
      consumidos30d: 340,
      ritmoDiario: 11.3,
      diasRestantes: 110,
      actualizadoEn: "2026-09-01T15:23:11.421Z",
    });
  });

  it("sin consumo los días restantes vienen null y se respetan", () => {
    expect(interpretarSaldo({ ...SALDO_AXON, estimated_days_remaining: null }).diasRestantes).toBeNull();
  });

  it("acepta números escritos como texto y rellena lo que falte", () => {
    const saldo = interpretarSaldo({ balance: "120" });
    expect(saldo.saldo).toBe(120);
    expect(saldo.consumidos30d).toBe(0);
    expect(saldo.diasRestantes).toBeNull();
    expect(saldo.actualizadoEn).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("sin balance es un formato inesperado", () => {
    expect(() => interpretarSaldo({ lifetime_credits: 5 })).toThrow(AxonError);
    expect(() => interpretarSaldo("hola")).toThrow(/formato inesperado/);
    expect(() => interpretarSaldo({ balance: "muchos" })).toThrow(AxonError);
  });
});

describe("interpretarPacks", () => {
  it("traduce el catálogo y calcula el precio por token si Axon no lo manda", () => {
    const catalogo = interpretarPacks(PACKS_AXON);
    expect(catalogo.moneda).toBe("MXN");
    expect(catalogo.packs[0]).toEqual({
      id: "pack_500",
      nombre: "Pack 500",
      tokens: 500,
      precioMxn: 1250,
      precioPorTokenMxn: 2.5,
      destacado: false,
    });
    expect(catalogo.packs[1].destacado).toBe(true);
    expect(catalogo.packs[1].precioPorTokenMxn).toBeCloseTo(3500 / 1500, 5);
  });

  it("un pack sin id, tokens o precio es un formato inesperado", () => {
    expect(() => interpretarPacks({ packs: [{ id: "pack_1" }] })).toThrow(AxonError);
    expect(() => interpretarPacks({ packs: "nada" })).toThrow(AxonError);
    expect(() => interpretarPacks(null)).toThrow(AxonError);
  });
});

describe("interpretarCheckout", () => {
  it("acepta una página de pago HTTPS de Stripe", () => {
    expect(interpretarCheckout(CHECKOUT_AXON)).toEqual({
      checkoutUrl: "https://checkout.stripe.com/c/pay/cs_live_123",
      pack: { id: "pack_1500", nombre: "Pack 1,500", tokens: 1500, precioMxn: 3500 },
      expiraEnMinutos: 30,
    });
  });

  it("rechaza URLs que no sean HTTPS de Stripe: al usuario no se le manda a otro sitio", () => {
    const con = (checkout_url: unknown) => () => interpretarCheckout({ ...CHECKOUT_AXON, checkout_url });
    expect(con("http://checkout.stripe.com/c/pay/x")).toThrow(/no es de Stripe/);
    expect(con("https://checkout.stripe.com.malo.mx/pay")).toThrow(AxonError);
    expect(con("https://malo.mx/stripe.com")).toThrow(AxonError);
    expect(con("javascript:alert(1)")).toThrow(AxonError);
    expect(con(undefined)).toThrow(AxonError);
  });
});

describe("leerPackId", () => {
  it("solo deja pasar ids con la forma del catálogo", () => {
    expect(leerPackId({ packId: "pack_1500" })).toBe("pack_1500");
    expect(leerPackId({ packId: "pack_" })).toBeNull();
    expect(leerPackId({ packId: "../billing" })).toBeNull();
    expect(leerPackId({ packId: "pack_1500 " })).toBeNull();
    expect(leerPackId({ packId: 1500 })).toBeNull();
    expect(leerPackId(null)).toBeNull();
  });
});

describe("consultas a Axon con fetch simulado", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    limpiarCacheAxon();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("AXON_API_KEY", "axk_prueba");
    vi.stubEnv("AXON_API_URL", "");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("el saldo se pide con la API key, por GET y sin cuerpo", async () => {
    fetchMock.mockResolvedValue(respuesta(200, SALDO_AXON));

    const saldo = await consultarSaldoAxon();

    expect(saldo.saldo).toBe(1247);
    const [url, opciones] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.axonlogic.com.mx/v1/public/billing/balance");
    expect(opciones?.method).toBe("GET");
    expect(opciones?.headers).toEqual({ "X-API-Key": "axk_prueba" });
    expect(opciones?.body).toBeUndefined();
  });

  it("el saldo se cachea 30 s y `forzar` salta la caché", async () => {
    vi.useFakeTimers();
    // Un Response solo se puede leer una vez: uno nuevo por llamada.
    fetchMock.mockImplementation(async () => respuesta(200, SALDO_AXON));

    await consultarSaldoAxon();
    await consultarSaldoAxon();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(29_000);
    await consultarSaldoAxon();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await consultarSaldoAxon({ forzar: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(31_000);
    await consultarSaldoAxon();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("ni forzando se consulta más de una vez cada 5 s: protege el límite de Axon", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async () => respuesta(200, SALDO_AXON));

    await consultarSaldoAxon({ forzar: true });
    await consultarSaldoAxon({ forzar: true });
    vi.advanceTimersByTime(4_000);
    await consultarSaldoAxon({ forzar: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1_000);
    await consultarSaldoAxon({ forzar: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("varias consultas simultáneas comparten una sola llamada a Axon", async () => {
    fetchMock.mockResolvedValue(respuesta(200, SALDO_AXON));

    const resultados = await Promise.all([consultarSaldoAxon(), consultarSaldoAxon(), consultarSaldoAxon()]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(resultados.every((r) => r.saldo === 1247)).toBe(true);
  });

  it("un error no se cachea: la siguiente consulta vuelve a intentar", async () => {
    fetchMock.mockResolvedValueOnce(respuesta(500)).mockResolvedValueOnce(respuesta(200, SALDO_AXON));

    await expect(consultarSaldoAxon()).rejects.toMatchObject({ codigo: "http", estado: 500 });
    await expect(consultarSaldoAxon()).resolves.toMatchObject({ saldo: 1247 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("el límite de peticiones de Axon (429) llega con su código y un motivo legible", async () => {
    fetchMock.mockResolvedValue(respuesta(429, { message: "Too Many Requests" }));

    await expect(consultarSaldoAxon()).rejects.toMatchObject({
      codigo: "http",
      estado: 429,
      motivo: expect.stringContaining("HTTP 429"),
    });
  });

  it("sin AXON_API_KEY no llama y lo dice", async () => {
    vi.stubEnv("AXON_API_KEY", "");

    await expect(consultarSaldoAxon()).rejects.toMatchObject({ codigo: "sin_configurar" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("una respuesta que no es JSON o un timeout se distinguen por código", async () => {
    fetchMock.mockResolvedValueOnce(respuesta(200, undefined, "<html>caído</html>"));
    await expect(consultarSaldoAxon()).rejects.toMatchObject({ codigo: "formato" });

    fetchMock.mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"));
    await expect(consultarSaldoAxon()).rejects.toMatchObject({ codigo: "timeout" });

    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(consultarSaldoAxon()).rejects.toMatchObject({ codigo: "red" });
  });

  it("los packs se cachean", async () => {
    fetchMock.mockResolvedValue(respuesta(200, PACKS_AXON));

    const primero = await listarPacksAxon();
    const segundo = await listarPacksAxon();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.axonlogic.com.mx/v1/public/billing/packs");
    expect(primero.packs).toHaveLength(2);
    expect(segundo).toBe(primero);
  });

  it("la compra manda el pack y las URLs de regreso por POST y devuelve la página de Stripe", async () => {
    fetchMock.mockResolvedValue(respuesta(200, CHECKOUT_AXON));

    const checkout = await iniciarCheckoutAxon("pack_1500", {
      exito: "https://vidaurri.hlsistemas.com/dashboard/axon?pago=ok",
      cancelado: "https://vidaurri.hlsistemas.com/dashboard/axon?pago=cancelado",
    });

    expect(checkout.checkoutUrl).toBe("https://checkout.stripe.com/c/pay/cs_live_123");
    const [url, opciones] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.axonlogic.com.mx/v1/public/billing/checkout");
    expect(opciones?.method).toBe("POST");
    expect(opciones?.headers).toEqual({
      "X-API-Key": "axk_prueba",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(opciones?.body))).toEqual({
      pack_id: "pack_1500",
      return_url_success: "https://vidaurri.hlsistemas.com/dashboard/axon?pago=ok",
      return_url_cancel: "https://vidaurri.hlsistemas.com/dashboard/axon?pago=cancelado",
    });
  });
});
