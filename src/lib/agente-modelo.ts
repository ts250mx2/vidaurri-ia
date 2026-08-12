import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

// Adaptador de proveedor para el agente VIDA (patrón de kyk-server-web):
// el loop del agente siempre habla "formato Anthropic" (mensajes con bloques
// tool_use / tool_result) y aquí se enruta por prefijo del modelo.

export interface UsoHerramienta {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface TurnoAgente {
  modelo: string;
  sistema: string;
  herramientas: Anthropic.Tool[];
  mensajes: Anthropic.MessageParam[];
  maxTokens: number;
  /** Última ronda: fuerza respuesta de texto sin herramientas. */
  sinHerramientas?: boolean;
  alTexto: (fragmento: string) => void;
}

export interface ResultadoTurno {
  contenido: Anthropic.ContentBlock[];
  usos: UsoHerramienta[];
}

export function esModeloOpenAI(modelo: string): boolean {
  return /^(gpt-|o\d)/i.test(modelo.trim());
}

export function claveFaltante(modelo: string): string | null {
  if (esModeloOpenAI(modelo)) return process.env.OPENAI_API_KEY ? null : "OPENAI_API_KEY";
  return process.env.ANTHROPIC_API_KEY ? null : "ANTHROPIC_API_KEY";
}

export async function correrTurnoAgente(turno: TurnoAgente): Promise<ResultadoTurno> {
  return esModeloOpenAI(turno.modelo) ? turnoOpenAI(turno) : turnoAnthropic(turno);
}

// ---------- Anthropic ----------

async function turnoAnthropic(turno: TurnoAgente): Promise<ResultadoTurno> {
  const anthropic = new Anthropic(); // lee ANTHROPIC_API_KEY del entorno
  const stream = anthropic.messages.stream({
    model: turno.modelo,
    max_tokens: turno.maxTokens,
    // cache_control: el prefijo sistema+herramientas se cachea entre rondas.
    system: [{ type: "text", text: turno.sistema, cache_control: { type: "ephemeral" } }],
    tools: turno.herramientas,
    ...(turno.sinHerramientas ? { tool_choice: { type: "none" as const } } : {}),
    messages: turno.mensajes,
  });
  stream.on("text", turno.alTexto);
  const resultado = await stream.finalMessage();

  const usos = resultado.content
    .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
    .map((b) => ({ id: b.id, name: b.name, input: (b.input ?? {}) as Record<string, unknown> }));
  const pidioHerramientas = resultado.stop_reason === "tool_use" && usos.length > 0;
  return { contenido: resultado.content, usos: pidioHerramientas ? usos : [] };
}

// ---------- OpenAI ----------

type MensajeOpenAI = OpenAI.Chat.Completions.ChatCompletionMessageParam;

/** Traduce el historial formato Anthropic al formato chat.completions. */
function traducirMensajes(sistema: string, mensajes: Anthropic.MessageParam[]): MensajeOpenAI[] {
  const salida: MensajeOpenAI[] = [{ role: "system", content: sistema }];
  for (const mensaje of mensajes) {
    if (typeof mensaje.content === "string") {
      salida.push({ role: mensaje.role, content: mensaje.content });
      continue;
    }
    if (mensaje.role === "assistant") {
      let texto = "";
      const llamadas: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] = [];
      for (const bloque of mensaje.content) {
        if (bloque.type === "text") texto += bloque.text;
        if (bloque.type === "tool_use") {
          llamadas.push({
            id: bloque.id,
            type: "function",
            function: { name: bloque.name, arguments: JSON.stringify(bloque.input ?? {}) },
          });
        }
      }
      salida.push({
        role: "assistant",
        content: texto || null,
        ...(llamadas.length ? { tool_calls: llamadas } : {}),
      });
    } else {
      for (const bloque of mensaje.content) {
        if (bloque.type === "tool_result") {
          salida.push({
            role: "tool",
            tool_call_id: bloque.tool_use_id,
            content: typeof bloque.content === "string" ? bloque.content : JSON.stringify(bloque.content),
          });
        } else if (bloque.type === "text") {
          salida.push({ role: "user", content: bloque.text });
        }
      }
    }
  }
  return salida;
}

async function turnoOpenAI(turno: TurnoAgente): Promise<ResultadoTurno> {
  const openai = new OpenAI(); // lee OPENAI_API_KEY del entorno
  const stream = await openai.chat.completions.create({
    model: turno.modelo,
    max_completion_tokens: turno.maxTokens,
    messages: traducirMensajes(turno.sistema, turno.mensajes),
    ...(turno.sinHerramientas
      ? {}
      : {
          tools: turno.herramientas.map((h) => ({
            type: "function" as const,
            function: {
              name: h.name,
              description: h.description ?? "",
              parameters: (h.input_schema ?? { type: "object" }) as Record<string, unknown>,
            },
          })),
        }),
    stream: true,
  });

  let texto = "";
  // Los tool_calls llegan fragmentados por índice: se acumulan aquí.
  const llamadas = new Map<number, { id: string; name: string; args: string }>();
  for await (const parte of stream) {
    const delta = parte.choices[0]?.delta;
    if (!delta) continue;
    if (delta.content) {
      texto += delta.content;
      turno.alTexto(delta.content);
    }
    for (const llamada of delta.tool_calls ?? []) {
      const actual = llamadas.get(llamada.index) ?? { id: "", name: "", args: "" };
      if (llamada.id) actual.id = llamada.id;
      if (llamada.function?.name) actual.name += llamada.function.name;
      if (llamada.function?.arguments) actual.args += llamada.function.arguments;
      llamadas.set(llamada.index, actual);
    }
  }

  // Reconstruye bloques formato Anthropic para el historial del loop.
  const contenido: Anthropic.ContentBlock[] = [];
  if (texto) {
    contenido.push({ type: "text", text: texto, citations: [] } as Anthropic.ContentBlock);
  }
  const usos: UsoHerramienta[] = [];
  for (const [, llamada] of [...llamadas.entries()].sort((a, b) => a[0] - b[0])) {
    let input: Record<string, unknown> = {};
    try {
      input = JSON.parse(llamada.args || "{}");
    } catch {
      // argumentos ilegibles: se pasa vacío y la herramienta reportará el error
    }
    usos.push({ id: llamada.id, name: llamada.name, input });
    contenido.push({
      type: "tool_use",
      id: llamada.id,
      name: llamada.name,
      input,
    } as Anthropic.ContentBlock);
  }
  return { contenido, usos };
}
