import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { HlClienteError, agenteConfigurado, obtenerLlave, type AgenteHl, type EntornoHl } from "./hl-cliente";

// Adaptador de proveedor para los agentes (patrón de kyk-server-web): el loop
// del agente siempre habla "formato Anthropic" (mensajes con bloques tool_use /
// tool_result) y aquí se enruta por proveedor.
//
// Proveedor, modelo y llave salen de HL Servidor (hl-cliente.ts), uno por
// agente: VIDA con HL_AGENTE_VIDA y Vico —mostrador, página web y WhatsApp—
// con HL_AGENTE_VICO. Del .env ya no se lee ningún modelo ni llave de
// proveedor: cambiar de modelo o rotar la llave se hace en el portal de HL.
//
// Respaldo: si HL_AGENTE_RESPALDO está configurado, la credencial de cada
// agente lleva adentro la de respaldo. Si el turno falla por causas del
// servicio o de la cuenta (ver esFalloDelServicio), se repite con ella; como
// cada llamada traduce la conversación completa, cambiar de proveedor a media
// conversación no pierde contexto.

/** Proveedores que este adaptador sabe correr. */
export type ProveedorIA = "claude" | "openai";

/** Con qué corre un turno: lo que HL entrega para cada agente. */
export interface CredencialIA {
  proveedor: ProveedorIA;
  modelo: string;
  llave: string;
  /** A qué credencial cae el turno si esta falla (HL_AGENTE_RESPALDO); null o ausente = sin respaldo. */
  respaldo?: CredencialIA | null;
}

export interface UsoHerramienta {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface TurnoAgente extends CredencialIA {
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

/** El proveedor que manda HL, si este adaptador lo sabe correr; null para gemini, otro… */
export function proveedorSoportado(proveedor: string): ProveedorIA | null {
  const limpio = proveedor.trim().toLowerCase();
  return limpio === "claude" || limpio === "openai" ? limpio : null;
}

/**
 * Proveedor, modelo y llave con que corre el agente, según HL. Sube un
 * HlClienteError si HL no contesta (y no hay llave previa en cache) o si
 * asigna un proveedor que aquí no se sabe correr.
 */
export async function credencialDeAgente(
  agente: AgenteHl,
  obtener: typeof obtenerLlave = obtenerLlave
): Promise<CredencialIA> {
  const { proveedor, modelo, llave } = await obtener(agente);
  const soportado = proveedorSoportado(proveedor);
  if (!soportado) {
    throw new HlClienteError(
      `HL asignó al agente ${agente} el proveedor "${proveedor}", que este sistema no sabe correr (solo claude u openai)`
    );
  }
  return { proveedor: soportado, modelo, llave };
}

/** Lo que ve quien usa el agente cuando HL no dio credencial; el detalle va al log. */
export const ERROR_SIN_IA = "El servicio de IA no está disponible en este momento; intenta de nuevo en unos minutos";

export type CredencialParaRuta = { ok: true; credencial: CredencialIA } | { ok: false; error: string };

export interface DependenciasRuta {
  /** Quién pide las llaves a HL (inyectable en pruebas). */
  obtener?: typeof obtenerLlave;
  env?: EntornoHl;
}

function mismaCredencial(a: CredencialIA, b: CredencialIA): boolean {
  return a.proveedor === b.proveedor && a.modelo === b.modelo && a.llave === b.llave;
}

/**
 * Para las rutas: la credencial del agente —con la de respaldo adentro, si HL
 * la dio— o un mensaje presentable. Nunca sube: el motivo (HL caído, key
 * inválida, IP no autorizada, llave caducada, proveedor no soportado) queda en
 * el log, que es donde sirve.
 *
 * El respaldo es opcional (HL_AGENTE_RESPALDO) y se pide junto con la llave
 * del agente, sin sumar espera. Si HL no da la del agente pero sí la de
 * respaldo —la llave del agente caducó o está desactivada en el portal—, el
 * agente corre con la de respaldo en vez de quedarse mudo.
 */
export async function credencialParaRuta(
  agente: Exclude<AgenteHl, "respaldo">,
  { obtener = obtenerLlave, env = process.env }: DependenciasRuta = {}
): Promise<CredencialParaRuta> {
  const [principal, respaldo] = await Promise.allSettled([
    credencialDeAgente(agente, obtener),
    agenteConfigurado("respaldo", env) ? credencialDeAgente("respaldo", obtener) : Promise.resolve(null),
  ]);

  if (respaldo.status === "rejected") {
    console.error(`[hl] sin credencial de respaldo (HL_AGENTE_RESPALDO):`, respaldo.reason);
  }
  const deRespaldo = respaldo.status === "fulfilled" ? respaldo.value : null;

  if (principal.status === "fulfilled") {
    const util = deRespaldo && !mismaCredencial(deRespaldo, principal.value) ? deRespaldo : null;
    return { ok: true, credencial: { ...principal.value, respaldo: util } };
  }

  console.error(`[hl] sin credencial para el agente ${agente}:`, principal.reason);
  if (deRespaldo) {
    console.warn(`[hl] el agente ${agente} corre con la credencial de respaldo (${deRespaldo.modelo})`);
    return { ok: true, credencial: { ...deRespaldo, respaldo: null } };
  }
  return { ok: false, error: ERROR_SIN_IA };
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
  /** Credencial de respaldo; undefined = la que trae el turno, null = sin respaldo. */
  respaldo?: CredencialIA | null;
  /** Quién ejecuta el turno contra el proveedor (inyectable en pruebas). */
  ejecutar?: (turno: TurnoAgente) => Promise<ResultadoTurno>;
}

function ejecutarTurno(turno: TurnoAgente): Promise<ResultadoTurno> {
  return turno.proveedor === "openai" ? turnoOpenAI(turno) : turnoAnthropic(turno);
}

/**
 * Corre un turno del agente y, si hay respaldo y el principal falla antes de
 * empezar a contestar, lo repite con él. Con texto ya emitido no se reintenta:
 * el usuario lo vería dos veces.
 */
export async function correrTurnoAgente(turno: TurnoAgente, opciones: OpcionesTurno = {}): Promise<ResultadoTurno> {
  const ejecutar = opciones.ejecutar ?? ejecutarTurno;
  const respaldo = opciones.respaldo !== undefined ? opciones.respaldo : (turno.respaldo ?? null);
  if (!respaldo) return ejecutar(turno);

  let emitido = false;
  const alTexto = (fragmento: string) => {
    if (fragmento) emitido = true;
    turno.alTexto(fragmento);
  };
  try {
    return await ejecutar({ ...turno, alTexto });
  } catch (error) {
    if (emitido || !esFalloDelServicio(error)) throw error;
    console.warn(`[respaldo] ${turno.modelo} falló (${describirError(error)}); se repite el turno con ${respaldo.modelo}`);
    try {
      // El respaldo no encadena otro respaldo: un solo reintento por turno.
      return await ejecutar({ ...turno, ...respaldo, respaldo: null });
    } catch (errorRespaldo) {
      console.error(`[respaldo] ${respaldo.modelo} también falló (${describirError(errorRespaldo)})`);
      throw errorRespaldo;
    }
  }
}

// ---------- Anthropic ----------

async function turnoAnthropic(turno: TurnoAgente): Promise<ResultadoTurno> {
  const anthropic = new Anthropic({ apiKey: turno.llave });
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
  const openai = new OpenAI({ apiKey: turno.llave });
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
