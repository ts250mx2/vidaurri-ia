/**
 * Cliente de HL Console: de ahí salen el proveedor y el modelo de cada agente
 * de IA, y por ahí pasan las llamadas al proveedor. Del .env solo se leen los
 * datos para hablar con HL:
 *   HL_URL             = http://127.0.0.1:3056  (sin diagonal final; HL sirve HTTP plano)
 *   HL_API_KEY         = hl_ + 48 hex           (key de acceso de esta app)
 *   HL_AGENTE_VIDA     = UUID del agente VIDA
 *   HL_AGENTE_VICO     = UUID del agente Vico (mostrador, página web y WhatsApp)
 *   HL_AGENTE_RESPALDO = UUID del agente de respaldo (opcional: si el proveedor
 *                        de VIDA o de Vico falla, el turno se repite con él)
 *   HL_TTL_MIN         = 30                     (opcional, minutos de cache)
 *
 * MODO PROXY: esta aplicación nunca recibe la llave del proveedor. El SDK
 * oficial apunta a `/api/ws/proxy/<uuid>` (configProxy) y HL inyecta la llave y
 * fija el modelo del agente. Por eso aquí no hace falta HL_SECRET ni se
 * descifra nada: de `/api/ws/llave` solo se toman proveedor y modelo, para
 * saber qué SDK usar y qué anotar en la bitácora.
 *
 * Copia adaptada de hl-servidor/cliente/hl-cliente.ts: el original atiende un
 * solo agente (HL_AGENTE) con un solo cache; aquí cada agente tiene su UUID y
 * su propio cache, porque VIDA y Vico corren en el mismo proceso. La key de
 * acceso se llama HL_API_KEY en esta app.
 *
 * Si cambias el modelo o rotas la llave en el portal, se toma al vencer el
 * cache (HL_TTL_MIN) o al llamar limpiarCacheAgentes().
 */

/** vida y vico son los agentes; respaldo es la credencial a la que caen los dos si su proveedor falla. */
export type AgenteHl = "vida" | "vico" | "respaldo";

const VARIABLE_AGENTE: Readonly<Record<AgenteHl, string>> = {
  vida: "HL_AGENTE_VIDA",
  vico: "HL_AGENTE_VICO",
  respaldo: "HL_AGENTE_RESPALDO",
};

/** ¿Tiene UUID en el entorno? El respaldo es opcional: sin él ni se le pregunta a HL. */
export function agenteConfigurado(agente: AgenteHl, env: EntornoHl = process.env): boolean {
  return (env[VARIABLE_AGENTE[agente]] ?? "").trim() !== "";
}

/** Lo que HL sabe del agente. La llave NO viene aquí: va por el proxy. */
export interface AgenteIA {
  uuid: string;
  /** Nombre del agente en el portal ("Asistente VIDA"). */
  nombre: string;
  proveedor: "claude" | "openai" | "gemini" | "otro" | string;
  modelo: string;
  caducidad: string | null;
}

export interface HlClienteConfig {
  url: string;
  key: string;
  /** UUID del agente en HL. */
  agente: string;
  /** Minutos que se conserva la respuesta en memoria. */
  ttlMinutos: number;
  /** Milisegundos máximos de espera por respuesta. */
  timeoutMs: number;
}

/** Variables de entorno que importan aquí (process.env o un doble en pruebas). */
export type EntornoHl = Record<string, string | undefined>;

export interface OpcionesAgente {
  /** Ignora el cache y vuelve a preguntar a HL. */
  forzar?: boolean;
  env?: EntornoHl;
  /** fetch a usar (inyectable en pruebas). */
  fetch?: typeof fetch;
  /** Reloj en milisegundos (inyectable en pruebas). */
  ahora?: () => number;
}

export class HlClienteError extends Error {
  /** Código HTTP con que contestó HL; null si ni siquiera contestó. */
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "HlClienteError";
    this.status = status;
  }
}

const DEFAULT_TTL_MINUTOS = 30;
const DEFAULT_TIMEOUT_MS = 10_000;
const MS_POR_MINUTO = 60_000;
const KEY_FORMAT = /^hl_[0-9a-f]{48}$/;
const UUID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function leerConfigHl(agente: AgenteHl, env: EntornoHl = process.env): HlClienteConfig {
  const variable = VARIABLE_AGENTE[agente];
  const url = (env.HL_URL ?? "").trim().replace(/\/+$/, "");
  const key = (env.HL_API_KEY ?? "").trim();
  const uuid = (env[variable] ?? "").trim();
  const ttl = Number(env.HL_TTL_MIN);

  if (!url) throw new HlClienteError("Falta HL_URL en el entorno");
  if (!KEY_FORMAT.test(key)) throw new HlClienteError("HL_API_KEY ausente o con formato inválido (hl_ + 48 hex)");
  if (!UUID_FORMAT.test(uuid)) throw new HlClienteError(`${variable} ausente o no es un UUID válido`);

  return {
    url,
    key,
    agente: uuid,
    ttlMinutos: Number.isFinite(ttl) && ttl > 0 ? ttl : DEFAULT_TTL_MINUTOS,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
}

export interface ConfigProxy {
  /** baseURL para el SDK del proveedor; al de OpenAI hay que agregarle /v1. */
  baseURL: string;
  headers: Record<string, string>;
}

/**
 * Cómo apuntar el SDK oficial al proxy de HL. La llave que pide el SDK es de
 * mentiras ("hl"): HL la sustituye por la real del agente, igual que el modelo.
 */
export function configProxy(agente: AgenteHl, env: EntornoHl = process.env): ConfigProxy {
  const config = leerConfigHl(agente, env);
  return {
    baseURL: `${config.url}/api/ws/proxy/${config.agente}`,
    headers: { "X-HL-Key": config.key },
  };
}

function esTexto(valor: unknown): valor is string {
  return typeof valor === "string" && valor.trim() !== "";
}

/**
 * Lo que manda HL no se confía sin revisar su forma. La llave no se mira
 * siquiera: en modo proxy no sale del servidor de HL.
 */
function validarAgente(data: unknown): AgenteIA | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;
  if (!esTexto(d.proveedor) || !esTexto(d.modelo)) return null;
  return {
    uuid: typeof d.uuid === "string" ? d.uuid : "",
    nombre: typeof d.agente === "string" ? d.agente : "",
    proveedor: d.proveedor.trim().toLowerCase(),
    modelo: d.modelo.trim(),
    caducidad: typeof d.caducidad === "string" ? d.caducidad : null,
  };
}

/**
 * "fetch failed" solo dice que no hubo respuesta: el motivo real (ECONNREFUSED,
 * ENOTFOUND, un https:// contra un puerto que habla http…) viene en `cause`.
 */
function detalleDeRed(error: unknown, url: string): string {
  if (!(error instanceof Error)) return "error de red";
  const causa = error.cause;
  if (!(causa instanceof Error)) return error.message;
  const codigo = (causa as { code?: unknown }).code;
  const detalle = `${error.message} (${typeof codigo === "string" ? `${codigo}: ` : ""}${causa.message})`;
  // El tropiezo más común al configurar: HL sirve HTTP plano.
  if (url.startsWith("https://") && /ssl|tls|wrong version|certificate|EPROTO/i.test(causa.message)) {
    return `${detalle}. HL Console sirve HTTP plano: si no está detrás de un proxy con certificado, usa http:// en HL_URL`;
  }
  return detalle;
}

async function consultarWs(config: HlClienteConfig, pedir: typeof fetch): Promise<AgenteIA> {
  const url = `${config.url}/api/ws/llave/${config.agente}`;
  let response: Response;
  try {
    response = await pedir(url, {
      headers: { "X-HL-Key": config.key, Accept: "application/json" },
      signal: AbortSignal.timeout(config.timeoutMs),
      cache: "no-store",
    });
  } catch (error) {
    throw new HlClienteError(`No se pudo conectar con HL Console (${url}): ${detalleDeRed(error, config.url)}`);
  }

  let body: { success?: unknown; data?: unknown; error?: unknown };
  try {
    body = (await response.json()) as typeof body;
  } catch {
    throw new HlClienteError(`HL Console respondió ${response.status} sin JSON válido`, response.status);
  }

  if (!response.ok || body.success !== true) {
    const mensaje = esTexto(body.error) ? body.error : `HL Console respondió ${response.status}`;
    throw new HlClienteError(mensaje, response.status);
  }
  const agente = validarAgente(body.data);
  if (!agente) throw new HlClienteError("HL Console respondió sin proveedor o sin modelo", response.status);
  return agente;
}

interface EntradaCache {
  valor: AgenteIA;
  expira: number;
}

/** Por UUID del agente: VIDA, Vico y el respaldo nunca comparten entrada. */
const cache = new Map<string, EntradaCache>();
const enCurso = new Map<string, Promise<AgenteIA>>();

/**
 * Proveedor y modelo del agente, según HL. Cachea en memoria durante HL_TTL_MIN
 * minutos y junta las peticiones simultáneas del mismo agente en una sola. Si
 * el refresco falla y hay un valor previo, lo reutiliza para no dejar mudo al
 * agente mientras HL vuelve.
 */
export async function obtenerAgente(agente: AgenteHl, opciones: OpcionesAgente = {}): Promise<AgenteIA> {
  const config = leerConfigHl(agente, opciones.env ?? process.env);
  const ahora = opciones.ahora ?? Date.now;
  const clave = config.agente;

  const guardada = cache.get(clave);
  if (!opciones.forzar && guardada && guardada.expira > ahora()) return guardada.valor;
  const pendiente = enCurso.get(clave);
  if (pendiente) return pendiente;

  const peticion = consultarWs(config, opciones.fetch ?? fetch)
    .then((valor) => {
      cache.set(clave, { valor, expira: ahora() + config.ttlMinutos * MS_POR_MINUTO });
      return valor;
    })
    .catch((error: unknown) => {
      const previa = cache.get(clave);
      if (previa) {
        console.error(`[hl] falló el refresco del agente ${agente}; se reutiliza lo anterior.`, error);
        return previa.valor;
      }
      throw error;
    })
    .finally(() => {
      enCurso.delete(clave);
    });
  enCurso.set(clave, peticion);
  return peticion;
}

/** Descarta el cache de todos los agentes. Útil tras cambiar el modelo en el portal. */
export function limpiarCacheAgentes(): void {
  cache.clear();
}
