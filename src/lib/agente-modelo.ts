import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

// Adaptador de proveedor para los agentes (patrón de kyk-server-web): el loop
// del agente siempre habla "formato Anthropic" (mensajes con bloques tool_use /
// tool_result) y aquí se enruta por prefijo del modelo.
//
// Respaldo: si el modelo principal falla por causas del servicio (sin
// conexión, timeout, 429, 5xx incluido el 529 "overloaded") y hay
// MODELO_RESPALDO configurado con su clave, el mismo turno se repite con el
// respaldo. Como cada llamada traduce la conversación completa, cambiar de
// proveedor a mitad de una conversación no pierde contexto.

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
  /** Modelo que contestó de verdad (el respaldo, si el principal falló).
   *  Opcional para que los dobles de prueba de los agentes sigan valiendo. */
  modelo?: string;
}

export function esModeloOpenAI(modelo: string): boolean {
  return /^(gpt-|o\d)/i.test(modelo.trim());
}

/** Variables de entorno que importan aquí (process.env o un doble en pruebas). */
export type EntornoModelos = Record<string, string | undefined>;

export function claveFaltante(modelo: string, env: EntornoModelos = process.env): string | null {
  if (esModeloOpenAI(modelo)) return env.OPENAI_API_KEY ? null : "OPENAI_API_KEY";
  return env.ANTHROPIC_API_KEY ? null : "ANTHROPIC_API_KEY";
}

/**
 * Modelo al que se cae si el principal falla: MODELO_RESPALDO del .env, siempre
 * que sea otro modelo y su proveedor tenga clave. null = sin respaldo.
 */
export function modeloRespaldoPara(modelo: string, env: EntornoModelos = process.env): string | null {
  const respaldo = env.MODELO_RESPALDO?.trim();
  if (!respaldo || respaldo === modelo.trim()) return null;
  if (claveFaltante(respaldo, env)) return null;
  return respaldo;
}

/**
 * Portero de las rutas: qué clave falta para poder contestar, o null si se
 * puede. A diferencia de `claveFaltante`, que falte la del modelo principal no
 * apaga el servicio mientras el respaldo pueda tomar el turno — si no, quitar
 * la clave de Anthropic dejaría a los agentes mudos teniendo OpenAI a la mano.
 */
export function claveFaltanteConRespaldo(modelo: string, env: EntornoModelos = process.env): string | null {
  const falta = claveFaltante(modelo, env);
  if (!falta || modeloRespaldoPara(modelo, env)) return null;
  return falta;
}

/**
 * ¿Conviene repetir el turno en el otro proveedor? Sin conexión o timeout,
 * límite de peticiones (429), conflicto/timeout del servidor (408/409) o error
 * 5xx (incluido el 529 "overloaded" de Anthropic).
 *
 * También el 401 (`authentication_error`: llave inválida o revocada) y el 403
 * (`permission_error`, o `billing_error` cuando la cuenta se quedó sin saldo).
 * Esos dos no son fallos del servicio sino de configuración o de cuenta, pero
 * desde el mostrador se ven igual —el agente se calla y el cliente no recibe
 * respuesta—, así que se atiende con el respaldo y el motivo queda en el log.
 *
 * Un 400 o un 404 sí es de nuestra petición: repetirla en otro modelo daría el
 * mismo error.
 */
export function esFalloDelServicio(error: unknown): boolean {
  if (error instanceof Anthropic.APIConnectionError || error instanceof OpenAI.APIConnectionError) return true;
  const status =
    error instanceof Anthropic.APIError || error instanceof OpenAI.APIError ? error.status : undefined;
  if (typeof status !== "number") return false;
  if (status === 401 || status === 403) return true;
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function describirError(error: unknown): string {
  if (error instanceof Anthropic.APIError || error instanceof OpenAI.APIError) {
    return `${error.status ?? "sin conexión"}: ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

export interface OpcionesTurno {
  /** Modelo de respaldo; undefined = el del .env, null = sin respaldo. */
  respaldo?: string | null;
  /** Quién ejecuta el turno contra el proveedor (inyectable en pruebas). */
  ejecutar?: (turno: TurnoAgente) => Promise<ResultadoTurno>;
  /** De dónde salen MODELO_RESPALDO y las claves (inyectable en pruebas). */
  env?: EntornoModelos;
}

function ejecutarTurno(turno: TurnoAgente): Promise<ResultadoTurno> {
  return esModeloOpenAI(turno.modelo) ? turnoOpenAI(turno) : turnoAnthropic(turno);
}

/**
 * Corre un turno del agente y, si el proveedor principal falla antes de
 * empezar a contestar, lo repite con el modelo de respaldo. Con texto ya
 * emitido no se reintenta: el usuario lo vería dos veces.
 */
export async function correrTurnoAgente(turno: TurnoAgente, opciones: OpcionesTurno = {}): Promise<ResultadoTurno> {
  const ejecutar = opciones.ejecutar ?? ejecutarTurno;
  const env = opciones.env ?? process.env;
  const respaldo = opciones.respaldo === undefined ? modeloRespaldoPara(turno.modelo, env) : opciones.respaldo;
  if (!respaldo) return ejecutar(turno);

  // Sin la clave del proveedor principal el intento es un fallo seguro: el SDK
  // ni siquiera llega a la red y su error no es "del servicio", así que no
  // dispararía el respaldo. Se arranca directo con él.
  const sinClave = claveFaltante(turno.modelo, env);
  if (sinClave) {
    console.warn(`[respaldo] falta ${sinClave}; el turno de ${turno.modelo} va directo a ${respaldo}`);
    return ejecutar({ ...turno, modelo: respaldo });
  }

  let emitido = false;
  const alTexto = (fragmento: string) => {
    if (fragmento) emitido = true;
    turno.alTexto(fragmento);
  };
  try {
    return await ejecutar({ ...turno, alTexto });
  } catch (error) {
    if (emitido || !esFalloDelServicio(error)) throw error;
    console.warn(`[respaldo] ${turno.modelo} falló (${describirError(error)}); se repite el turno con ${respaldo}`);
    try {
      return await ejecutar({ ...turno, modelo: respaldo });
    } catch (errorRespaldo) {
      console.error(`[respaldo] ${respaldo} también falló (${describirError(errorRespaldo)})`);
      throw errorRespaldo;
    }
  }
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
  return { contenido: resultado.content, usos: pidioHerramientas ? usos : [], modelo: turno.modelo };
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
  // Los modelos gpt-5.x son razonadores; chat.completions NO admite function
  // tools con reasoning_effort activo, así que se fuerza a 'none' (además va
  // más rápido para un agente con herramientas).
  const esRazonadorGpt5 = /^gpt-5/i.test(turno.modelo.trim());
  const stream = await openai.chat.completions.create({
    model: turno.modelo,
    max_completion_tokens: turno.maxTokens,
    messages: traducirMensajes(turno.sistema, turno.mensajes),
    ...(esRazonadorGpt5 ? { reasoning_effort: "none" as const } : {}),
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
  return { contenido, usos, modelo: turno.modelo };
}
