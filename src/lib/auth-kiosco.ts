import { NextResponse } from "next/server";
import { apiKeyValida } from "@/lib/api-key";
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
  | { ok: true; kiosco: SesionKiosco }
  | { ok: false; respuesta: NextResponse };

/** Qué capa rechazó: la llave de vidaurri-page o la cabecera del aparato. */
export type CodigoNoAutorizadoKiosco = "api_key" | "kiosco";

function respuestaNoAutorizado(codigo: CodigoNoAutorizadoKiosco): NextResponse {
  return NextResponse.json(
    { ok: false, error: codigo === "api_key" ? "Servicio no autorizado" : "Kiosco no autorizado", codigo },
    { status: 401 }
  );
}

/**
 * Guardia estándar de toda ruta /api/kiosco/*: la API key de vidaurri-page
 * (misma variable que el mostrador, MOSTRADOR_API_KEY: es la misma página
 * llamando al mismo motor) y la cabecera del aparato. Los dos fallos son 401
 * con `codigo` distinto para que la página sepa si es la llave rotada o un
 * kiosco sin activar, igual que en exigirMostrador.
 */
export async function exigirKiosco(request: Request): Promise<ResultadoExigirKiosco> {
  if (!apiKeyValida(request, "MOSTRADOR_API_KEY")) {
    return { ok: false, respuesta: respuestaNoAutorizado("api_key") };
  }
  const kiosco = leerCabeceraKiosco(request.headers.get(CABECERA_KIOSCO));
  if (!kiosco) return { ok: false, respuesta: respuestaNoAutorizado("kiosco") };
  return { ok: true, kiosco };
}
