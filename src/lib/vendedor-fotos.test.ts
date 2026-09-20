import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { correrVendedor, textoConFotos, type ImagenParaModelo } from "./vendedor";
import { correrTurnoAgente, type CredencialIA } from "./agente-modelo";

// Vico ve las fotos que manda el cliente. Va en archivo aparte de
// vendedor.test.ts para no depender de su arnés.
vi.mock("./agente-modelo", () => ({ correrTurnoAgente: vi.fn() }));
vi.mock("./db", () => ({ consultaBdav: vi.fn() }));
vi.mock("./db-usadas", () => ({ consultaUsadas: vi.fn() }));
vi.mock("./aldo", () => ({ precioAldo: vi.fn() }));

const CREDENCIAL: CredencialIA = {
  proveedor: "claude",
  modelo: "claude-test",
  baseURL: "http://hl/api/ws/proxy/prueba",
  headers: {},
};
const FOTO: ImagenParaModelo = { mediaType: "image/jpeg", base64: "QUJD" };

/** `mensajes` se sigue mutando después de cada ronda: se guarda como estaba al llamar. */
function capturarTurnos(respuestas: Array<"ok" | { status: number }>) {
  const vistos: Anthropic.MessageParam[][] = [];
  let llamada = 0;
  vi.mocked(correrTurnoAgente).mockImplementation(async (op) => {
    vistos.push(structuredClone(op.mensajes));
    const respuesta = respuestas[llamada++] ?? "ok";
    if (respuesta !== "ok") throw Object.assign(new Error("image input not supported"), respuesta);
    op.alTexto?.("Claro, te ayudo.");
    return { contenido: [], usos: [] };
  });
  return vistos;
}

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("textoConFotos", () => {
  it("sin fotos deja la pregunta tal cual", () => {
    expect(textoConFotos("cofre versa 2015", 0)).toBe("cofre versa 2015");
  });

  it("con fotos antepone la instrucción; una foto sola también es un turno", () => {
    expect(textoConFotos("¿la tienes?", 1)).toMatch(/^\[El cliente envió una foto\.[^]*\]\n\n¿la tienes\?$/);
    expect(textoConFotos("", 2)).toMatch(/^\[El cliente envió 2 fotos\.[^]*\]$/);
  });

  it("avisa de las fotos que no se pudieron abrir", () => {
    expect(textoConFotos("hola", 0, 1)).toMatch(/una foto que no se pudo abrir[^]*\n\nhola$/);
  });
});

describe("correrVendedor con fotos", () => {
  it("manda las fotos como bloques de imagen antes del texto del cliente", async () => {
    const vistos = capturarTurnos(["ok"]);

    await correrVendedor({ pregunta: "¿tienes esta?", historial: [], credencial: CREDENCIAL, imagenes: [FOTO, FOTO] });

    expect(vistos[0]).toEqual([
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "QUJD" } },
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "QUJD" } },
          { type: "text", text: textoConFotos("¿tienes esta?", 2) },
        ],
      },
    ]);
  });

  it("sin fotos el turno sigue siendo el texto de siempre", async () => {
    const vistos = capturarTurnos(["ok"]);

    await correrVendedor({ pregunta: "cofre versa", historial: [], credencial: CREDENCIAL });

    expect(vistos[0]).toEqual([{ role: "user", content: "cofre versa" }]);
  });

  it("si el modelo no acepta imágenes repite el turno sin ellas y el cliente recibe respuesta", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const vistos = capturarTurnos([{ status: 400 }, "ok"]);

    const texto = await correrVendedor({ pregunta: "¿tienes esta?", historial: [], credencial: CREDENCIAL, imagenes: [FOTO] });

    expect(texto).toBe("Claro, te ayudo.");
    expect(vistos).toHaveLength(2);
    expect(vistos[1]).toEqual([{ role: "user", content: textoConFotos("¿tienes esta?", 0, 1) }]);
  });

  it("un rechazo sin fotos de por medio no se disfraza: el error sube", async () => {
    capturarTurnos([{ status: 400 }]);

    await expect(correrVendedor({ pregunta: "cofre", historial: [], credencial: CREDENCIAL })).rejects.toThrow(
      /not supported/
    );
    expect(correrTurnoAgente).toHaveBeenCalledTimes(1);
  });
});
