/**
 * Cliente de HL Servidor: de ahí salen el proveedor, el modelo y la llave de
 * cada agente de IA. Del .env solo se leen los datos para hablar con HL:
 *   HL_URL          = http://localhost:3055         (sin diagonal final)
 *   HL_API_KEY      = hl_ + 48 hex                  (key de acceso de esta app)
 *   HL_AGENTE_VIDA  = UUID del agente VIDA
 *   HL_AGENTE_VICO  = UUID del agente Vico (mostrador, página web y WhatsApp)
 *   HL_AGENTE_RESPALDO = UUID del agente de respaldo (opcional: si el
 *                        proveedor de VIDA o de Vico falla, el turno se
 *                        repite con él)
 *   HL_TTL_MIN      = 30                            (opcional, minutos de cache)
 *
 * Copia adaptada de hl-servidor/cliente/hl-cliente.ts. El original atiende un
 * solo agente (HL_AGENTE) con un solo cache; aquí cada agente tiene su UUID y
 * su propio cache, porque VIDA y Vico corren en el mismo proceso y con un cache
 * compartido el segundo leería la llave del primero. La key de acceso se llama
 * HL_API_KEY en esta app.
 *
 * Si rotas la llave o cambias el modelo en el portal, se toma al vencer el
 * cache (HL_TTL_MIN) o al llamar limpiarCacheLlave().
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

export interface LlaveIA {
  uuid: string;
  agente: string;
  proveedor: "claude" | "openai" | "gemini" | "otro" | string;
  modelo: string;
  llave: string;
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

export interface OpcionesLlave {
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

function esTexto(valor: unknown): valor is string {
  return typeof valor === "string" && valor.trim() !== "";
}

/** Lo que manda HL no se confía sin revisar su forma: sin proveedor, modelo o llave no sirve. */
function validarLlave(data: unknown): LlaveIA | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;
  if (!esTexto(d.proveedor) || !esTexto(d.modelo) || !esTexto(d.llave)) return null;
  return {
    uuid: typeof d.uuid === "string" ? d.uuid : "",
    agente: typeof d.agente === "string" ? d.agente : "",
    proveedor: d.proveedor.trim().toLowerCase(),
    modelo: d.modelo.trim(),
    llave: d.llave.trim(),
    caducidad: typeof d.caducidad === "string" ? d.caducidad : null,
  };
}

async function consultarWs(config: HlClienteConfig, pedir: typeof fetch): Promise<LlaveIA> {
  const url = `${config.url}/api/ws/llave/${config.agente}`;
  let response: Response;
  try {
    response = await pedir(url, {
      headers: { "X-HL-Key": config.key, Accept: "application/json" },
      signal: AbortSignal.timeout(config.timeoutMs),
      cache: "no-store",
    });
  } catch (error) {
    const detalle = error instanceof Error ? error.message : "error de red";
    throw new HlClienteError(`No se pudo conectar con HL Servidor (${url}): ${detalle}`);
  }

  let body: { success?: unknown; data?: unknown; error?: unknown };
  try {
    body = (await response.json()) as typeof body;
  } catch {
    throw new HlClienteError(`HL Servidor respondió ${response.status} sin JSON válido`, response.status);
  }

  if (!response.ok || body.success !== true) {
    const mensaje = esTexto(body.error) ? body.error : `HL Servidor respondió ${response.status}`;
    throw new HlClienteError(mensaje, response.status);
  }
  const llave = validarLlave(body.data);
  if (!llave) throw new HlClienteError("HL Servidor respondió sin proveedor, modelo o llave", response.status);
  return llave;
}

interface EntradaCache {
  valor: LlaveIA;
  expira: number;
}

/** Por UUID del agente: VIDA y Vico nunca comparten entrada. */
const cache = new Map<string, EntradaCache>();
const enCurso = new Map<string, Promise<LlaveIA>>();

/**
 * Proveedor, modelo y llave del agente. Cachea en memoria durante HL_TTL_MIN
 * minutos y junta las peticiones simultáneas del mismo agente en una sola. Si
 * el refresco falla y hay un valor previo, lo reutiliza para no dejar mudo al
 * agente mientras HL vuelve.
 */
export async function obtenerLlave(agente: AgenteHl, opciones: OpcionesLlave = {}): Promise<LlaveIA> {
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
        console.error(`[hl] falló el refresco de la llave de ${agente}; se reutiliza la anterior.`, error);
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

/** Descarta el cache de todos los agentes. Útil después de rotar la llave en el portal. */
export function limpiarCacheLlave(): void {
  cache.clear();
}
