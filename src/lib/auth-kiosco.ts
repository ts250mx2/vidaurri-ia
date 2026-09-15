import { NextResponse } from "next/server";
import { apiKeyValida } from "@/lib/api-key";
import { revalidarCliente } from "@/lib/auth-clientes";
import { leerIdRuta, type ClienteDescuento } from "@/lib/clientes-descuento";
import { esSucursal, type SucursalEntrega } from "@/lib/pedidos";

// Guardia de las rutas /api/kiosco/*: el kiosco de autoservicio del piso.
//
// Aquí NO hay persona ni sesión: la credencial es del APARATO. vidaurri-page
// guarda la cookie del kiosco (JWT propio, audiencia "kiosco", que verifica
// allá) y en cada llamada al motor manda su API key de servidor a servidor y
// la cabecera X-Kiosco con '<kiosco>|<sucursal>'. El navegador nunca ve la
// llave ni elige la sucursal.
//
// Este guardia NUNCA mira el Authorization: el JWT del mostrador no abre el
// kiosco (ni al revés la cookie del kiosco abre /mostrador). Son puertas
// distintas a propósito: el kiosco solo sabe crear pedidos, y si algún día
// alguien confundiera las dos, un aparato del piso podría leer la cola.

export const CABECERA_KIOSCO = "x-kiosco";

/** Identificador del aparato: minúsculas, dígitos y guiones. Entra en la
 *  clave del borrador ('k:<kiosco>'), así que se acota fuerte. */
const KIOSCO_VALIDO = /^[a-z0-9-]{1,30}$/;

export interface SesionKiosco {
  kiosco: string;
  sucursal: SucursalEntrega;
}

/**
 * Lee la cabecera '<kiosco>|<sucursal>'; null si falta, si trae otra cosa o
 * si alguno de los dos lados no pasa su validación. Pura: la prueban los tests.
 */
export function leerCabeceraKiosco(crudo: string | null): SesionKiosco | null {
  if (!crudo) return null;
  const partes = crudo.split("|");
  if (partes.length !== 2) return null;
  const kiosco = partes[0].trim();
  const sucursal = partes[1].trim();
  if (!KIOSCO_VALIDO.test(kiosco) || !esSucursal(sucursal)) return null;
  return { kiosco, sucursal };
}

export type ResultadoExigirKiosco =
  /** `cliente`: el del padrón que entró con su celular en ESTE aparato, o
   *  null = público general (todo sigue exactamente como sin cliente). */
  | { ok: true; kiosco: SesionKiosco; cliente: ClienteDescuento | null }
  | { ok: false; respuesta: NextResponse };

/** Qué capa rechazó: la llave de vidaurri-page, la cabecera del aparato o la
 *  del cliente (id malformado, o ya no está en el padrón). */
export type CodigoNoAutorizadoKiosco = "api_key" | "kiosco" | "cliente";

const ERROR_NO_AUTORIZADO: Record<CodigoNoAutorizadoKiosco, string> = {
  api_key: "Servicio no autorizado",
  kiosco: "Kiosco no autorizado",
  cliente: "Tu sesión de cliente ya no es válida; vuelve a entrar con tu celular",
};

export function respuestaNoAutorizadoKiosco(codigo: CodigoNoAutorizadoKiosco): NextResponse {
  return NextResponse.json({ ok: false, error: ERROR_NO_AUTORIZADO[codigo], codigo }, { status: 401 });
}
const respuestaNoAutorizado = respuestaNoAutorizadoKiosco;

// ---------------------------------------------------------------------------
// El cliente que entró con su celular (opcional, encima del aparato).
// ---------------------------------------------------------------------------

/** Cabecera opcional con el id del cliente del padrón que entró en el kiosco.
 *  La pone vidaurri-page a partir de su cookie `kiosco_cliente`; el motor no
 *  ve esa cookie, así que el id se revalida en el padrón en cada llamada. */
export const CABECERA_KIOSCO_CLIENTE = "x-kiosco-cliente";

/** Tres casos y no dos: "no viene" es público general, pero "viene mal" es un
 *  rechazo, nunca un silencioso "pues a precio de mostrador". */
export type CabeceraCliente =
  | { tipo: "sin_cliente" }
  | { tipo: "cliente"; idCliente: number }
  | { tipo: "invalida" };

/** Pura: la prueban los tests. Entero positivo estricto (leerIdRuta). */
export function leerCabeceraCliente(crudo: string | null): CabeceraCliente {
  const texto = crudo?.trim() ?? "";
  if (!texto) return { tipo: "sin_cliente" };
  const idCliente = leerIdRuta(texto);
  return idCliente === null ? { tipo: "invalida" } : { tipo: "cliente", idCliente };
}

type ResultadoCliente =
  | { ok: true; cliente: ClienteDescuento | null }
  | { ok: false; respuesta: NextResponse };

/**
 * Resuelve al cliente de la cabecera contra el padrón, con la misma
 * revalidación que el área de clientes (auth-clientes.ts): si el padrón no
 * responde la puerta se cierra (502), nunca se atiende "mientras tanto" a
 * precio de mostrador a alguien que entró como cliente.
 */
async function resolverCliente(request: Request): Promise<ResultadoCliente> {
  const cabecera = leerCabeceraCliente(request.headers.get(CABECERA_KIOSCO_CLIENTE));
  if (cabecera.tipo === "sin_cliente") return { ok: true, cliente: null };
  if (cabecera.tipo === "invalida") return { ok: false, respuesta: respuestaNoAutorizado("cliente") };
  const revalidado = await revalidarCliente(cabecera.idCliente, "kiosco");
  if (!revalidado.ok) return revalidado;
  return { ok: true, cliente: revalidado.cliente };
}

/**
 * Guardia estándar de toda ruta /api/kiosco/*: la API key de vidaurri-page
 * (misma variable que el mostrador, MOSTRADOR_API_KEY: es la misma página
 * llamando al mismo motor) y la cabecera del aparato. Los dos fallos son 401
 * con `codigo` distinto para que la página sepa si es la llave rotada o un
 * kiosco sin activar, igual que en exigirMostrador. Encima, y solo si viene,
 * la cabecera del cliente que entró con su celular (revalidada en el padrón).
 */
export async function exigirKiosco(request: Request): Promise<ResultadoExigirKiosco> {
  if (!apiKeyValida(request, "MOSTRADOR_API_KEY")) {
    return { ok: false, respuesta: respuestaNoAutorizado("api_key") };
  }
  const kiosco = leerCabeceraKiosco(request.headers.get(CABECERA_KIOSCO));
  if (!kiosco) return { ok: false, respuesta: respuestaNoAutorizado("kiosco") };
  const cliente = await resolverCliente(request);
  if (!cliente.ok) return cliente;
  return { ok: true, kiosco, cliente: cliente.cliente };
}

export type ResultadoExigirKioscoConCliente =
  | { ok: true; kiosco: SesionKiosco; cliente: ClienteDescuento }
  | { ok: false; respuesta: NextResponse };

/**
 * Las rutas que son del CLIENTE (sus pedidos): además del aparato exigen que
 * haya entrado con su celular. Sin cliente, 401 con código cliente: la página
 * lo manda a /kiosco/entrar.
 */
export async function exigirKioscoConCliente(request: Request): Promise<ResultadoExigirKioscoConCliente> {
  const guardia = await exigirKiosco(request);
  if (!guardia.ok) return guardia;
  if (!guardia.cliente) return { ok: false, respuesta: respuestaNoAutorizado("cliente") };
  return { ok: true, kiosco: guardia.kiosco, cliente: guardia.cliente };
}
