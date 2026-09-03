// Acceso a la API pública de Axon Logic (la pasarela de WhatsApp del Vendedor
// IA). Lo comparten la bienvenida al dar de alta un cliente
// (whatsapp-bienvenida.ts) y los créditos de WhatsApp (axon-creditos.ts). La
// API key es la de la cuenta de Vidaurri en Axon y solo vive en el servidor:
// nunca sale en respuestas ni en logs.

export const AXON_URL_BASE_DEFAULT = "https://api.axonlogic.com.mx";
export const MOTIVO_SIN_CONFIGURAR = "falta configurar AXON_API_KEY en el servidor";
const TIMEOUT_MS = 10_000;
/** Lo que se registra en el log del cuerpo de una respuesta de error. */
const DETALLE_LOG_MAX = 300;

export interface ConfiguracionAxon {
  apiKey: string;
  /** Sin diagonal final. */
  urlBase: string;
}

/** null si falta la API key: las funciones de Axon quedan apagadas, no rotas. */
export function configuracionAxon(): ConfiguracionAxon | null {
  const apiKey = process.env.AXON_API_KEY?.trim();
  if (!apiKey) return null;
  const urlBase = (process.env.AXON_API_URL?.trim() || AXON_URL_BASE_DEFAULT).replace(/\/+$/, "");
  return { apiKey, urlBase };
}

export type CodigoAxon = "sin_configurar" | "timeout" | "red" | "http" | "formato";

/** Fallo hablando con Axon Logic, con un motivo apto para mostrarle al usuario. */
export class AxonError extends Error {
  constructor(
    readonly motivo: string,
    readonly codigo: CodigoAxon,
    /** Código HTTP de Axon cuando el fallo fue una respuesta de error. */
    readonly estado: number | null = null
  ) {
    super(motivo);
    this.name = "AxonError";
  }
}

export function esTimeout(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "TimeoutError"
  );
}

/** Motivo legible para el usuario según el código HTTP que devolvió Axon. */
export function motivoPorEstado(estado: number): string {
  if (estado === 401 || estado === 403) return "Axon Logic rechazó la API key";
  if (estado === 429) return "Axon Logic está limitando las peticiones (HTTP 429): espera unos segundos";
  if (estado >= 500) return `Axon Logic tuvo un error (HTTP ${estado})`;
  return `Axon Logic rechazó la petición (HTTP ${estado})`;
}

export interface OpcionesPeticionAxon {
  method?: "GET" | "POST";
  /** Se serializa como JSON. */
  body?: unknown;
  /** Para el log del servidor ('Saldo Axon', 'Bienvenida WhatsApp al 81…'). */
  etiqueta: string;
}

/**
 * Una petición a Axon Logic con la API key, timeout y errores traducidos.
 * Devuelve el JSON de la respuesta (null si vino vacía). Lanza AxonError con
 * un motivo para el usuario; el detalle técnico va al log, sin la API key.
 */
export async function peticionAxon(ruta: string, opciones: OpcionesPeticionAxon): Promise<unknown> {
  const config = configuracionAxon();
  if (!config) throw new AxonError(MOTIVO_SIN_CONFIGURAR, "sin_configurar");

  const headers: Record<string, string> = { "X-API-Key": config.apiKey };
  if (opciones.body !== undefined) headers["Content-Type"] = "application/json";

  let respuesta: Response;
  try {
    respuesta = await fetch(`${config.urlBase}${ruta}`, {
      method: opciones.method ?? "GET",
      headers,
      body: opciones.body === undefined ? undefined : JSON.stringify(opciones.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const timeout = esTimeout(error);
    const motivo = timeout ? "Axon Logic no respondió a tiempo" : "no se pudo conectar con Axon Logic";
    console.error(`${opciones.etiqueta}: ${motivo}`, error);
    throw new AxonError(motivo, timeout ? "timeout" : "red");
  }

  const texto = await respuesta.text().catch(() => "");
  if (!respuesta.ok) {
    console.error(`${opciones.etiqueta}: HTTP ${respuesta.status} ${texto.slice(0, DETALLE_LOG_MAX)}`);
    throw new AxonError(motivoPorEstado(respuesta.status), "http", respuesta.status);
  }
  if (!texto.trim()) return null;
  try {
    return JSON.parse(texto) as unknown;
  } catch {
    console.error(`${opciones.etiqueta}: respuesta que no es JSON ${texto.slice(0, DETALLE_LOG_MAX)}`);
    throw new AxonError("Axon Logic devolvió una respuesta inesperada", "formato", respuesta.status);
  }
}
