import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { traducirMensajes } from "./agente-modelo";

// El loop de los agentes habla formato Anthropic; cuando HL asigna un proveedor
// del API de OpenAI los mensajes se traducen. Antes de esto un bloque de imagen
// se perdía en silencio en la traducción. Va en archivo aparte de
// agente-modelo.test.ts para no depender de su arnés.

const FOTO: Anthropic.ImageBlockParam = {
  type: "image",
  source: { type: "base64", media_type: "image/jpeg", data: "QUJD" },
};

describe("traducirMensajes con fotos", () => {
  it("la foto y lo que el cliente dice de ella van en UN mensaje de usuario", () => {
    const salida = traducirMensajes("Eres Vico", [
      { role: "user", content: [FOTO, { type: "text", text: "¿tienes esta pieza?" }] },
    ]);

    expect(salida).toEqual([
      { role: "system", content: "Eres Vico" },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: "data:image/jpeg;base64,QUJD" } },
          { type: "text", text: "¿tienes esta pieza?" },
        ],
      },
    ]);
  });

  it("una imagen por URL pasa con su URL", () => {
    const salida = traducirMensajes("s", [
      { role: "user", content: [{ type: "image", source: { type: "url", url: "https://cdn.ejemplo.com/a.jpg" } }] },
    ]);

    expect(salida[1]).toEqual({
      role: "user",
      content: [{ type: "image_url", image_url: { url: "https://cdn.ejemplo.com/a.jpg" } }],
    });
  });

  it("sin fotos todo sigue igual: el texto va como cadena y los resultados de herramienta por su lado", () => {
    const salida = traducirMensajes("s", [
      { role: "user", content: "hola" },
      { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "buscar_productos", input: { descripcion: "cofre" } }] },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "t1", content: '{"total":0}' },
          { type: "text", text: "y también un faro" },
        ],
      },
    ]);

    expect(salida.slice(1)).toEqual([
      { role: "user", content: "hola" },
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "t1", type: "function", function: { name: "buscar_productos", arguments: '{"descripcion":"cofre"}' } }],
      },
      { role: "tool", tool_call_id: "t1", content: '{"total":0}' },
      { role: "user", content: "y también un faro" },
    ]);
  });
});
