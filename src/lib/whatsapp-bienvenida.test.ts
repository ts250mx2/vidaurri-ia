import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClienteDescuento } from "./clientes-descuento";
import {
  claveIdempotencia,
  enviarBienvenidaWhatsapp,
  MOTIVO_SIN_CONFIGURAR,
  resumenBienvenida,
  resumenReenvio,
  telefonoE164,
} from "./whatsapp-bienvenida";

const CLIENTE: ClienteDescuento = {
  id: 77,
  telefono: "8112345678",
  telefonos: ["8112345678"],
  cliente: "Juan Pérez",
  descuento: 38,
  rfc: null,
  telefono2: null,
  email: null,
  idClienteApv: null,
  idClienteBdav: null,
  permitirPedido: false,
  creadoPor: "ruben",
  creadoEn: "2026-09-02 10:00:00",
  actualizadoPor: "ruben",
  actualizadoEn: "2026-09-02 10:00:00",
};

function respuesta(status: number, cuerpo = ""): Response {
  return new Response(cuerpo, { status });
}

describe("telefonoE164", () => {
  it("a un número nacional de 10 dígitos le pone la lada de México", () => {
    expect(telefonoE164("8112345678")).toBe("+528112345678");
  });

  it("un número con país (11 a 15 dígitos) solo lleva el +", () => {
    expect(telefonoE164("12125551234")).toBe("+12125551234");
    expect(telefonoE164("123456789012345")).toBe("+123456789012345");
  });

  it("rechaza lo que no sea un teléfono completo", () => {
    expect(telefonoE164("811234567")).toBeNull();
    expect(telefonoE164("81 1234 5678")).toBeNull();
    expect(telefonoE164("")).toBeNull();
    expect(telefonoE164("1234567890123456")).toBeNull();
  });
});

describe("claveIdempotencia", () => {
  it("es una por cliente y celular", () => {
    expect(claveIdempotencia(77, "8112345678")).toBe("cliente-77-8112345678");
  });
});

describe("enviarBienvenidaWhatsapp", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("AXON_API_KEY", "axk_prueba");
    vi.stubEnv("AXON_API_URL", "");
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("manda teléfono E.164, nombre y clave de idempotencia con la API key", async () => {
    fetchMock.mockResolvedValue(respuesta(200, '{"ok":true}'));

    const resultado = await enviarBienvenidaWhatsapp(CLIENTE);

    expect(resultado).toEqual({ enviados: ["8112345678"], fallidos: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opciones] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.axonlogic.com.mx/v1/public/customers/welcome");
    expect(opciones?.method).toBe("POST");
    expect(opciones?.headers).toEqual({
      "X-API-Key": "axk_prueba",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(opciones?.body))).toEqual({
      phone: "+528112345678",
      name: "Juan Pérez",
      idempotency_key: "cliente-77-8112345678",
    });
    expect(opciones?.signal).toBeInstanceOf(AbortSignal);
  });

  it("respeta AXON_API_URL (sin diagonal final repetida)", async () => {
    vi.stubEnv("AXON_API_URL", "https://pruebas.axon.local/");
    fetchMock.mockResolvedValue(respuesta(201));

    await enviarBienvenidaWhatsapp(CLIENTE);

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://pruebas.axon.local/v1/public/customers/welcome"
    );
  });

  it("pide una bienvenida por cada celular del cliente", async () => {
    fetchMock.mockResolvedValue(respuesta(200));
    const cliente = { ...CLIENTE, telefonos: ["8112345678", "8187654321"] };

    const resultado = await enviarBienvenidaWhatsapp(cliente);

    expect(resultado.enviados).toEqual(["8112345678", "8187654321"]);
    const claves = fetchMock.mock.calls.map(
      ([, opciones]) => JSON.parse(String(opciones?.body)).idempotency_key
    );
    expect(claves).toEqual(["cliente-77-8112345678", "cliente-77-8187654321"]);
  });

  it("sin celulares no llama a la pasarela", async () => {
    const resultado = await enviarBienvenidaWhatsapp({ ...CLIENTE, telefono: null, telefonos: [] });

    expect(resultado).toEqual({ enviados: [], fallidos: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sin AXON_API_KEY no llama y lo reporta como fallido", async () => {
    vi.stubEnv("AXON_API_KEY", "  ");

    const resultado = await enviarBienvenidaWhatsapp(CLIENTE);

    expect(resultado).toEqual({
      enviados: [],
      fallidos: [{ telefono: "8112345678", motivo: MOTIVO_SIN_CONFIGURAR }],
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("una respuesta de error queda como fallido con motivo legible, sin la API key", async () => {
    fetchMock.mockResolvedValue(respuesta(401, '{"error":"invalid api key"}'));

    const resultado = await enviarBienvenidaWhatsapp(CLIENTE);

    expect(resultado.enviados).toEqual([]);
    expect(resultado.fallidos).toEqual([
      { telefono: "8112345678", motivo: "Axon Logic rechazó la API key" },
    ]);
    expect(JSON.stringify(resultado)).not.toContain("axk_prueba");
  });

  it("distingue errores del servidor y otros rechazos por el código HTTP", async () => {
    fetchMock.mockResolvedValueOnce(respuesta(503)).mockResolvedValueOnce(respuesta(422));
    const cliente = { ...CLIENTE, telefonos: ["8112345678", "8187654321"] };

    const resultado = await enviarBienvenidaWhatsapp(cliente);

    expect(resultado.fallidos).toEqual([
      { telefono: "8112345678", motivo: "Axon Logic tuvo un error (HTTP 503)" },
      { telefono: "8187654321", motivo: "Axon Logic rechazó la petición (HTTP 422)" },
    ]);
  });

  it("un fallo de red o un timeout no tumba el alta", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"));
    const cliente = { ...CLIENTE, telefonos: ["8112345678", "8187654321"] };

    const resultado = await enviarBienvenidaWhatsapp(cliente);

    expect(resultado.enviados).toEqual([]);
    expect(resultado.fallidos.map((f) => f.motivo)).toEqual([
      "no se pudo conectar con Axon Logic",
      "Axon Logic no respondió a tiempo",
    ]);
  });

  it("separa los que sí se enviaron de los que fallaron", async () => {
    fetchMock.mockResolvedValueOnce(respuesta(500)).mockResolvedValueOnce(respuesta(200));
    const cliente = { ...CLIENTE, telefonos: ["8112345678", "8187654321"] };

    const resultado = await enviarBienvenidaWhatsapp(cliente);

    expect(resultado.enviados).toEqual(["8187654321"]);
    expect(resultado.fallidos.map((f) => f.telefono)).toEqual(["8112345678"]);
  });
});

describe("resumenBienvenida", () => {
  it("sin celulares no hay nada que contar", () => {
    expect(resumenBienvenida(undefined)).toBeNull();
    expect(resumenBienvenida({ enviados: [], fallidos: [] })).toBeNull();
  });

  it("enumera los celulares a los que sí llegó", () => {
    expect(resumenBienvenida({ enviados: ["8112345678"], fallidos: [] })).toEqual({
      texto: " y se le envió la bienvenida por WhatsApp al 8112345678",
      conFallas: false,
    });
    expect(
      resumenBienvenida({ enviados: ["8112345678", "8187654321", "8100000000"], fallidos: [] })
        ?.texto
    ).toBe(" y se le envió la bienvenida por WhatsApp al 8112345678, 8187654321 y 8100000000");
  });

  it("cuando todo falló lo dice con el motivo", () => {
    expect(
      resumenBienvenida({
        enviados: [],
        fallidos: [{ telefono: "8112345678", motivo: "Axon Logic rechazó la API key" }],
      })
    ).toEqual({
      texto:
        ", pero no se pudo enviar la bienvenida por WhatsApp al 8112345678 (Axon Logic rechazó la API key)",
      conFallas: true,
    });
  });

  it("cuando unos llegaron y otros no, cuenta ambos", () => {
    expect(
      resumenBienvenida({
        enviados: ["8112345678"],
        fallidos: [{ telefono: "8187654321", motivo: "Axon Logic no respondió a tiempo" }],
      })
    ).toEqual({
      texto:
        " y se le envió la bienvenida por WhatsApp al 8112345678, pero no al 8187654321 (Axon Logic no respondió a tiempo)",
      conFallas: true,
    });
  });
});

describe("resumenReenvio", () => {
  const FALLA = { telefono: "8187654321", motivo: "Axon Logic tuvo un error (HTTP 500)" };

  it("sin celulares lo dice como falla", () => {
    expect(resumenReenvio("Juan Pérez", { enviados: [], fallidos: [] })).toEqual({
      texto: "Juan Pérez no tiene celular al que mandar la bienvenida",
      conFallas: true,
    });
  });

  it("cuando llegó a todos es una frase completa con el nombre", () => {
    expect(resumenReenvio("Juan Pérez", { enviados: ["8112345678"], fallidos: [] })).toEqual({
      texto: "Se reenvió la bienvenida por WhatsApp de Juan Pérez al 8112345678",
      conFallas: false,
    });
  });

  it("cuando todo falló lo dice con el motivo", () => {
    expect(resumenReenvio("Juan Pérez", { enviados: [], fallidos: [FALLA] })).toEqual({
      texto:
        "No se pudo reenviar la bienvenida de Juan Pérez al 8187654321 (Axon Logic tuvo un error (HTTP 500))",
      conFallas: true,
    });
  });

  it("cuando unos llegaron y otros no, cuenta ambos", () => {
    expect(resumenReenvio("Juan Pérez", { enviados: ["8112345678"], fallidos: [FALLA] })).toEqual({
      texto:
        "Se reenvió la bienvenida por WhatsApp de Juan Pérez al 8112345678, pero no al 8187654321 (Axon Logic tuvo un error (HTTP 500))",
      conFallas: true,
    });
  });
});
