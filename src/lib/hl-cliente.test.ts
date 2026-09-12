import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HlClienteError,
  agenteConfigurado,
  configProxy,
  leerConfigHl,
  limpiarCacheAgentes,
  obtenerAgente,
  type AgenteIA,
  type EntornoHl,
} from "./hl-cliente";

const UUID_VIDA = "11111111-2222-4333-8444-555555555555";
const UUID_VICO = "66666666-7777-4888-9999-aaaaaaaaaaaa";
const UUID_RESPALDO = "0b7e5f3c-1d2a-4c9e-8f00-6a5b4c3d2e1f";

const ENV: EntornoHl = {
  HL_URL: "http://hl.prueba:3056/",
  HL_API_KEY: `hl_${"a".repeat(48)}`,
  HL_AGENTE_VIDA: UUID_VIDA,
  HL_AGENTE_VICO: UUID_VICO,
};

const MINUTO = 60_000;

/** Lo que responde HL en `data`: incluye la llave cifrada, que aquí se ignora. */
function datosHl(parcial: Record<string, unknown> = {}) {
  return {
    uuid: UUID_VIDA,
    agente: "Asistente VIDA",
    proveedor: "claude",
    modelo: "claude-opus-5",
    llave: null,
    llaveCifrada: "aXY=.dGFn.Y2lmcmFkbw==",
    cifrado: "aes-256-gcm",
    caducidad: null,
    ...parcial,
  };
}

function respuesta(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function hlResponde(data: Record<string, unknown>) {
  return respuesta({ success: true, data, error: null });
}

afterEach(() => {
  limpiarCacheAgentes();
  vi.restoreAllMocks();
});

describe("leerConfigHl y configProxy", () => {
  it("toma la URL sin diagonal final, la key y el UUID del agente pedido", () => {
    const config = leerConfigHl("vico", ENV);

    expect(config.url).toBe("http://hl.prueba:3056");
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

  it("el proxy apunta al agente y lleva la key en el header", () => {
    expect(configProxy("vico", ENV)).toEqual({
      baseURL: `http://hl.prueba:3056/api/ws/proxy/${UUID_VICO}`,
      headers: { "X-HL-Key": ENV.HL_API_KEY },
    });
  });
});

describe("obtenerAgente", () => {
  it("pide el agente con X-HL-Key y devuelve proveedor y modelo", async () => {
    const pedir = vi.fn<typeof fetch>().mockResolvedValue(hlResponde(datosHl()));

    const valor = await obtenerAgente("vida", { env: ENV, fetch: pedir });

    expect(valor).toEqual<AgenteIA>({
      uuid: UUID_VIDA,
      nombre: "Asistente VIDA",
      proveedor: "claude",
      modelo: "claude-opus-5",
      caducidad: null,
    });
    const [url, init] = pedir.mock.calls[0];
    expect(String(url)).toBe(`http://hl.prueba:3056/api/ws/llave/${UUID_VIDA}`);
    expect(new Headers(init?.headers).get("X-HL-Key")).toBe(ENV.HL_API_KEY);
  });

  it("la llave cifrada de HL ni se mira: en modo proxy no hace falta descifrar nada", async () => {
    const pedir = vi.fn<typeof fetch>().mockResolvedValue(hlResponde(datosHl()));

    const valor = await obtenerAgente("vida", { env: ENV, fetch: pedir });

    expect(JSON.stringify(valor)).not.toContain("cifrad");
    expect(Object.keys(valor)).not.toContain("llave");
  });

  it("cada agente tiene su propio cache: VIDA y Vico no se pisan el modelo", async () => {
    const pedir = vi.fn<typeof fetch>().mockImplementation(async (url) =>
      String(url).endsWith(UUID_VICO)
        ? hlResponde(datosHl({ uuid: UUID_VICO, agente: "Asistente VICO", modelo: "claude-sonnet-5" }))
        : hlResponde(datosHl())
    );

    const vida = await obtenerAgente("vida", { env: ENV, fetch: pedir });
    const vico = await obtenerAgente("vico", { env: ENV, fetch: pedir });
    await obtenerAgente("vida", { env: ENV, fetch: pedir });
    await obtenerAgente("vico", { env: ENV, fetch: pedir });

    expect(vida.modelo).toBe("claude-opus-5");
    expect(vico.modelo).toBe("claude-sonnet-5");
    expect(pedir).toHaveBeenCalledTimes(2);
  });

  it("dos turnos que preguntan por el mismo agente a la vez hacen una sola petición", async () => {
    const pedir = vi.fn<typeof fetch>().mockResolvedValue(hlResponde(datosHl()));

    const [a, b] = await Promise.all([
      obtenerAgente("vida", { env: ENV, fetch: pedir }),
      obtenerAgente("vida", { env: ENV, fetch: pedir }),
    ]);

    expect(a.modelo).toBe(b.modelo);
    expect(pedir).toHaveBeenCalledTimes(1);
  });

  it("vencido el cache vuelve a pedir y toma el modelo nuevo del portal", async () => {
    let ahora = 0;
    const pedir = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(hlResponde(datosHl()))
      .mockResolvedValueOnce(hlResponde(datosHl({ modelo: "claude-sonnet-5" })));

    await obtenerAgente("vida", { env: ENV, fetch: pedir, ahora: () => ahora });
    ahora = 31 * MINUTO;
    const valor = await obtenerAgente("vida", { env: ENV, fetch: pedir, ahora: () => ahora });

    expect(valor.modelo).toBe("claude-sonnet-5");
    expect(pedir).toHaveBeenCalledTimes(2);
  });

  it("si HL falla al refrescar, reutiliza lo anterior en vez de dejar mudo al agente", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let ahora = 0;
    const pedir = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(hlResponde(datosHl()))
      .mockRejectedValueOnce(new TypeError("fetch failed"));

    await obtenerAgente("vida", { env: ENV, fetch: pedir, ahora: () => ahora });
    ahora = 31 * MINUTO;
    const valor = await obtenerAgente("vida", { env: ENV, fetch: pedir, ahora: () => ahora });

    expect(valor.modelo).toBe("claude-opus-5");
    expect(console.error).toHaveBeenCalled();
  });

  it("un rechazo de HL sube como HlClienteError con su status y su mensaje", async () => {
    const pedir = vi
      .fn<typeof fetch>()
      .mockResolvedValue(respuesta({ success: false, data: null, error: "IP no autorizada" }, 403));

    await expect(obtenerAgente("vida", { env: ENV, fetch: pedir })).rejects.toMatchObject({
      name: "HlClienteError",
      status: 403,
      message: "IP no autorizada",
    });
  });

  it("sin conexión con HL (y sin nada en cache) sube como HlClienteError sin status", async () => {
    const pedir = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed"));

    const error = await obtenerAgente("vida", { env: ENV, fetch: pedir }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HlClienteError);
    expect((error as HlClienteError).status).toBeNull();
  });

  it("el error de red lleva la causa real y no solo 'fetch failed'", async () => {
    const causa = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:3056"), { code: "ECONNREFUSED" });
    const pedir = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed", { cause: causa }));

    const error = await obtenerAgente("vida", { env: ENV, fetch: pedir }).catch((e: unknown) => e);

    expect((error as HlClienteError).message).toContain("ECONNREFUSED: connect ECONNREFUSED 127.0.0.1:3056");
  });

  it("con https:// y un error de TLS, el mensaje recuerda que HL sirve HTTP plano", async () => {
    const causa = new Error("write EPROTO ... wrong version number");
    const pedir = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed", { cause: causa }));

    const error = await obtenerAgente("vida", {
      env: { ...ENV, HL_URL: "https://server.hlsistemas.com:3056" },
      fetch: pedir,
    }).catch((e: unknown) => e);

    expect((error as HlClienteError).message).toContain("usa http:// en HL_URL");
  });

  it("una respuesta sin proveedor o sin modelo no se acepta", async () => {
    const sinProveedor = vi.fn<typeof fetch>().mockResolvedValue(hlResponde(datosHl({ proveedor: "" })));
    const sinModelo = vi.fn<typeof fetch>().mockResolvedValue(hlResponde(datosHl({ modelo: "  " })));

    await expect(obtenerAgente("vida", { env: ENV, fetch: sinProveedor })).rejects.toBeInstanceOf(HlClienteError);
    await expect(obtenerAgente("vico", { env: ENV, fetch: sinModelo })).rejects.toBeInstanceOf(HlClienteError);
  });
});
