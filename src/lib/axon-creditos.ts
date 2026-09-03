// Créditos de WhatsApp de la cuenta de Vidaurri en Axon Logic: saldo de
// tokens, catálogo de packs y compra vía Stripe (guía de integración v1.0,
// sep 2026). Un token = una conversación de 24 h con un cliente por WhatsApp.
//
// Axon pide no consultar el saldo más de una vez cada 30 s: se cachea aquí,
// en el servidor, para todos los usuarios del panel (la cuenta es una sola).
// Nada de lo que devuelve Axon se confía sin revisar su forma.

import { AxonError, peticionAxon } from "./axon";

const RUTA_SALDO = "/v1/public/billing/balance";
const RUTA_PACKS = "/v1/public/billing/packs";
const RUTA_CHECKOUT = "/v1/public/billing/checkout";
const CACHE_SALDO_MS = 30_000;
/** Ni forzando se consulta el saldo más seguido que esto: Axon limita a 60
 *  peticiones/min por cuenta, y un solo usuario dándole a "actualizar" no
 *  debe dejar sin saldo al chip de los demás. */
const FORZAR_MIN_MS = 5_000;
/** El catálogo de packs cambia rara vez. */
const CACHE_PACKS_MS = 10 * 60_000;
/** Al usuario solo se le manda a una página de pago de Stripe. */
const HOST_PAGO = /(^|\.)stripe\.com$/;
/** Los ids del catálogo son 'pack_500', 'pack_1500'…; nada más pasa al POST. */
const PACK_ID_VALIDO = /^pack_[a-z0-9_]{1,40}$/i;

export interface SaldoAxon {
  /** Tokens disponibles ahora mismo. */
  saldo: number;
  /** Total comprado o recibido históricamente. */
  creditosHistoricos: number;
  consumidos30d: number;
  /** Promedio diario de consumo (últimos 30 días). */
  ritmoDiario: number;
  /** null si aún no hay consumo. */
  diasRestantes: number | null;
  /** ISO UTC del cálculo en Axon. */
  actualizadoEn: string;
}

export interface PackAxon {
  id: string;
  nombre: string;
  tokens: number;
  precioMxn: number;
  precioPorTokenMxn: number | null;
  /** El "más popular", para resaltarlo. */
  destacado: boolean;
}

export interface CatalogoPacksAxon {
  packs: PackAxon[];
  moneda: string;
}

export interface CheckoutAxon {
  /** Página de pago de Stripe a la que se manda al usuario. */
  checkoutUrl: string;
  pack: { id: string; nombre: string; tokens: number; precioMxn: number };
  expiraEnMinutos: number | null;
}

export interface UrlsRetorno {
  exito: string;
  cancelado: string;
}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

/** Número finito; también acepta '1250' por si el JSON lo trae como texto. */
function numero(valor: unknown): number | null {
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;
  if (typeof valor === "string" && /^-?\d+(\.\d+)?$/.test(valor.trim())) return Number(valor);
  return null;
}

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() ? valor.trim() : null;
}

function formatoInesperado(que: string): AxonError {
  return new AxonError(`Axon Logic devolvió ${que} con formato inesperado`, "formato");
}

/** GET /balance → SaldoAxon. Solo `balance` es obligatorio; el resto tiene respaldo. */
export function interpretarSaldo(cuerpo: unknown): SaldoAxon {
  if (!esObjeto(cuerpo)) throw formatoInesperado("el saldo");
  const saldo = numero(cuerpo.balance);
  if (saldo === null) throw formatoInesperado("el saldo");
  const diasRestantes =
    cuerpo.estimated_days_remaining == null ? null : numero(cuerpo.estimated_days_remaining);
  return {
    saldo,
    creditosHistoricos: numero(cuerpo.lifetime_credits) ?? 0,
    consumidos30d: numero(cuerpo.consumed_last_30d) ?? 0,
    ritmoDiario: numero(cuerpo.daily_burn_rate) ?? 0,
    diasRestantes,
    actualizadoEn: texto(cuerpo.updated_at) ?? new Date().toISOString(),
  };
}

/** GET /packs → catálogo. Cada pack necesita id, tokens y precio. */
export function interpretarPacks(cuerpo: unknown): CatalogoPacksAxon {
  if (!esObjeto(cuerpo) || !Array.isArray(cuerpo.packs)) throw formatoInesperado("los packs");
  const packs = cuerpo.packs.map((pack): PackAxon => {
    if (!esObjeto(pack)) throw formatoInesperado("los packs");
    const id = texto(pack.id);
    const tokens = numero(pack.tokens);
    const precioMxn = numero(pack.price_mxn);
    if (!id || tokens === null || precioMxn === null) throw formatoInesperado("los packs");
    return {
      id,
      nombre: texto(pack.name) ?? id,
      tokens,
      precioMxn,
      precioPorTokenMxn: numero(pack.price_per_token_mxn) ?? (tokens > 0 ? precioMxn / tokens : null),
      destacado: pack.highlight === true,
    };
  });
  return { packs, moneda: texto(cuerpo.currency) ?? "MXN" };
}

function esUrlDePago(url: string): boolean {
  try {
    const parseada = new URL(url);
    return parseada.protocol === "https:" && HOST_PAGO.test(parseada.hostname);
  } catch {
    return false;
  }
}

/** POST /checkout → sesión de pago. La URL tiene que ser HTTPS de Stripe. */
export function interpretarCheckout(cuerpo: unknown): CheckoutAxon {
  if (!esObjeto(cuerpo)) throw formatoInesperado("la sesión de pago");
  const checkoutUrl = texto(cuerpo.checkout_url);
  if (!checkoutUrl || !esUrlDePago(checkoutUrl)) {
    throw new AxonError("Axon Logic devolvió una URL de pago que no es de Stripe", "formato");
  }
  const pack = esObjeto(cuerpo.pack) ? cuerpo.pack : {};
  return {
    checkoutUrl,
    pack: {
      id: texto(pack.id) ?? "",
      nombre: texto(pack.name) ?? "",
      tokens: numero(pack.tokens) ?? 0,
      precioMxn: numero(pack.price_mxn) ?? 0,
    },
    expiraEnMinutos: numero(cuerpo.expires_in_minutes),
  };
}

/** El `packId` del cuerpo que manda la interfaz; null si no parece un id del catálogo. */
export function leerPackId(cuerpo: unknown): string | null {
  if (!esObjeto(cuerpo)) return null;
  const packId = cuerpo.packId;
  return typeof packId === "string" && PACK_ID_VALIDO.test(packId) ? packId : null;
}

interface Cache<T> {
  datos: T;
  obtenido: number;
  expira: number;
}

let cacheSaldo: Cache<SaldoAxon> | null = null;
let saldoEnVuelo: Promise<SaldoAxon> | null = null;
let cachePacks: Cache<CatalogoPacksAxon> | null = null;
let packsEnVuelo: Promise<CatalogoPacksAxon> | null = null;

/** Para las pruebas. */
export function limpiarCacheAxon(): void {
  cacheSaldo = null;
  saldoEnVuelo = null;
  cachePacks = null;
  packsEnVuelo = null;
}

/**
 * Saldo de tokens, cacheado 30 s. `forzar` salta la caché (al volver de un
 * pago, para enseñar el saldo ya acreditado) salvo que se haya consultado hace
 * menos de 5 s. Varias peticiones simultáneas comparten una sola llamada.
 */
export async function consultarSaldoAxon(opciones: { forzar?: boolean } = {}): Promise<SaldoAxon> {
  const ahora = Date.now();
  if (cacheSaldo && cacheSaldo.expira > ahora) {
    const reciente = ahora - cacheSaldo.obtenido < FORZAR_MIN_MS;
    if (!opciones.forzar || reciente) return cacheSaldo.datos;
  }
  if (!saldoEnVuelo) {
    saldoEnVuelo = (async () => {
      try {
        const datos = interpretarSaldo(await peticionAxon(RUTA_SALDO, { etiqueta: "Saldo Axon" }));
        const obtenido = Date.now();
        cacheSaldo = { datos, obtenido, expira: obtenido + CACHE_SALDO_MS };
        return datos;
      } finally {
        saldoEnVuelo = null;
      }
    })();
  }
  return saldoEnVuelo;
}

/** Catálogo de packs con precios vigentes, cacheado 10 min. */
export async function listarPacksAxon(): Promise<CatalogoPacksAxon> {
  if (cachePacks && cachePacks.expira > Date.now()) return cachePacks.datos;
  if (!packsEnVuelo) {
    packsEnVuelo = (async () => {
      try {
        const datos = interpretarPacks(await peticionAxon(RUTA_PACKS, { etiqueta: "Packs Axon" }));
        const obtenido = Date.now();
        cachePacks = { datos, obtenido, expira: obtenido + CACHE_PACKS_MS };
        return datos;
      } finally {
        packsEnVuelo = null;
      }
    })();
  }
  return packsEnVuelo;
}

/**
 * Abre una sesión de pago en Stripe para un pack. Stripe regresa al usuario a
 * `urls.exito` o `urls.cancelado`; los tokens se acreditan solos al pagar.
 */
export async function iniciarCheckoutAxon(packId: string, urls: UrlsRetorno): Promise<CheckoutAxon> {
  const cuerpo = await peticionAxon(RUTA_CHECKOUT, {
    method: "POST",
    body: {
      pack_id: packId,
      return_url_success: urls.exito,
      return_url_cancel: urls.cancelado,
    },
    etiqueta: `Checkout Axon (${packId})`,
  });
  return interpretarCheckout(cuerpo);
}
