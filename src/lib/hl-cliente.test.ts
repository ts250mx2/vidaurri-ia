import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HlClienteError,
  agenteConfigurado,
  leerConfigHl,
  limpiarCacheLlave,
  obtenerLlave,
  type EntornoHl,
  type LlaveIA,
} from "./hl-cliente";

const UUID_VIDA = "11111111-2222-4333-8444-555555555555";
const UUID_VICO = "66666666-7777-4888-9999-aaaaaaaaaaaa";
const UUID_RESPALDO = "0b7e5f3c-1d2a-4c9e-8f00-6a5b4c3d2e1f";

const ENV: EntornoHl = {
  HL_URL: "http://hl.prueba:3055/",
  HL_API_KEY: `hl_${"a".repeat(48)}`,
  HL_AGENTE_VIDA: UUID_VIDA,
  HL_AGENTE_VICO: UUID_VICO,
};

const MINUTO = 60_000;

function llave(parcial: Partial<LlaveIA> = {}): LlaveIA {
  return {
    uuid: UUID_VIDA,
    agente: "Asistente VIDA",
    proveedor: "claude",
    modelo: "claude-opus-5",
    llave: "sk-ant-prueba",
    caducidad: null,
    ...parcial,
  };
}

function respuesta(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function hlResponde(data: LlaveIA) {
  return respuesta({ success: true, data, error: null });
}

afterEach(() => {
  limpiarCacheLlave();
  vi.restoreAllMocks();
});

describe("leerConfigHl", () => {
  it("toma la URL sin diagonal final, la key y el UUID del agente pedido", () => {
    const config = leerConfigHl("vico", ENV);

    expect(config.url).toBe("http://hl.prueba:3055");
    expect(config.key).toBe(ENV.HL_API_KEY);
    expect(config.agente).toBe(UUID_VICO);
  });

  it("sin HL_URL, con la key mal formada o sin UUID del agente, falla nombrando la variable", () => {
    expect(() => leerConfigHl("vida", { ...ENV, HL_URL: "" })).toThrow(/HL_URL/);
    expect(() => leerConfigHl("vida", { ...ENV, HL_API_KEY: "hl_corta" })).toThrow(/HL_API_KEY/);
    expect(() => leerConfigHl("vida", { ...ENV, HL_AGENTE_VIDA: undefined })).toThrow(/HL_AGENTE_VIDA/);
    expect(() => leerConfigHl("vico", { ...ENV, HL_AGENTE_VICO: "no-es-uuid" })).toThrow(/HL_AGENTE_VICO/);
  });

  it("el respaldo es opcional: sin UUID ni se configura, con él se lee de HL_AGENTE_RESPALDO", () => {
    expect(agenteConfigurado("vida", ENV)).toBe(true);
    expect(agenteConfigurado("respaldo", ENV)).toBe(false);
    expect(agenteConfigurado("respaldo", { ...ENV, HL_AGENTE_RESPALDO: "  " })).toBe(false);

    expect(leerConfigHl("respaldo", { ...ENV, HL_AGENTE_RESPALDO: UUID_RESPALDO }).agente).toBe(UUID_RESPALDO);
    expect(() => leerConfigHl("respaldo", ENV)).toThrow(/HL_AGENTE_RESPALDO/);
  });
});

describe("obtenerLlave", () => {
  it("pide la llave del agente con X-HL-Key y devuelve proveedor, modelo y llave", async () => {
    const pedir = vi.fn<typeof fetch>().mockResolvedValue(hlResponde(llave()));

    const valor = await obtenerLlave("vida", { env: ENV, fetch: pedir });

    expect(valor).toMatchObject({ proveedor: "claude", modelo: "claude-opus-5", llave: "sk-ant-prueba" });
    const [url, init] = pedir.mock.calls[0];
    expect(String(url)).toBe(`http://hl.prueba:3055/api/ws/llave/${UUID_VIDA}`);
    expect(new Headers(init?.headers).get("X-HL-Key")).toBe(ENV.HL_API_KEY);
  });

  it("cada agente tiene su propio cache: VIDA y Vico no se pisan la llave", async () => {
    const pedir = vi.fn<typeof fetch>().mockImplementation(async (url) =>
      String(url).endsWith(UUID_VICO)
        ? hlResponde(llave({ uuid: UUID_VICO, agente: "Asistente VICO", modelo: "claude-sonnet-5" }))
        : hlResponde(llave())
    );

    const vida = await obtenerLlave("vida", { env: ENV, fetch: pedir });
    const vico = await obtenerLlave("vico", { env: ENV, fetch: pedir });
    await obtenerLlave("vida", { env: ENV, fetch: pedir });
    await obtenerLlave("vico", { env: ENV, fetch: pedir });

    expect(vida.modelo).toBe("claude-opus-5");
    expect(vico.modelo).toBe("claude-sonnet-5");
    expect(pedir).toHaveBeenCalledTimes(2);
  });

  it("dos turnos que piden la misma llave a la vez hacen una sola petición", async () => {
    const pedir = vi.fn<typeof fetch>().mockResolvedValue(hlResponde(llave()));

    const [a, b] = await Promise.all([
      obtenerLlave("vida", { env: ENV, fetch: pedir }),
      obtenerLlave("vida", { env: ENV, fetch: pedir }),
    ]);

    expect(a.llave).toBe(b.llave);
    expect(pedir).toHaveBeenCalledTimes(1);
  });

  it("vencido el cache vuelve a pedir y toma el modelo nuevo del portal", async () => {
    let ahora = 0;
    const pedir = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(hlResponde(llave()))
      .mockResolvedValueOnce(hlResponde(llave({ modelo: "claude-sonnet-5" })));

    await obtenerLlave("vida", { env: ENV, fetch: pedir, ahora: () => ahora });
    ahora = 31 * MINUTO;
    const valor = await obtenerLlave("vida", { env: ENV, fetch: pedir, ahora: () => ahora });

    expect(valor.modelo).toBe("claude-sonnet-5");
    expect(pedir).toHaveBeenCalledTimes(2);
  });

  it("si HL falla al refrescar, reutiliza la llave anterior en vez de dejar mudo al agente", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let ahora = 0;
    const pedir = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(hlResponde(llave()))
      .mockRejectedValueOnce(new TypeError("fetch failed"));

    await obtenerLlave("vida", { env: ENV, fetch: pedir, ahora: () => ahora });
    ahora = 31 * MINUTO;
    const valor = await obtenerLlave("vida", { env: ENV, fetch: pedir, ahora: () => ahora });

    expect(valor.llave).toBe("sk-ant-prueba");
    expect(console.error).toHaveBeenCalled();
  });

  it("un rechazo de HL sube como HlClienteError con su status y su mensaje", async () => {
    const pedir = vi
      .fn<typeof fetch>()
      .mockResolvedValue(respuesta({ success: false, data: null, error: "IP no autorizada" }, 403));

    await expect(obtenerLlave("vida", { env: ENV, fetch: pedir })).rejects.toMatchObject({
      name: "HlClienteError",
      status: 403,
      message: "IP no autorizada",
    });
  });

  it("sin conexión con HL (y sin llave previa) sube como HlClienteError sin status", async () => {
    const pedir = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed"));

    const error = await obtenerLlave("vida", { env: ENV, fetch: pedir }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HlClienteError);
    expect((error as HlClienteError).status).toBeNull();
  });

  it("una respuesta sin llave o sin modelo no se acepta", async () => {
    const sinLlave = vi.fn<typeof fetch>().mockResolvedValue(hlResponde(llave({ llave: "" })));
    const sinModelo = vi.fn<typeof fetch>().mockResolvedValue(hlResponde(llave({ modelo: "  " })));

    await expect(obtenerLlave("vida", { env: ENV, fetch: sinLlave })).rejects.toBeInstanceOf(HlClienteError);
    await expect(obtenerLlave("vico", { env: ENV, fetch: sinModelo })).rejects.toBeInstanceOf(HlClienteError);
  });
});
