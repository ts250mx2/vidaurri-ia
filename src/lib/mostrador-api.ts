import { NextResponse } from "next/server";
import type { SesionMostrador } from "@/lib/auth-mostrador";
import { leerIdRuta } from "@/lib/clientes-descuento";
import { ReferenciaApvDuplicadaError, TelefonoDuplicadoError } from "@/lib/db-clientes-descuento";
import {
  LimitePedidoError,
  PartidaNoEncontradaError,
  PedidoNoEditableError,
  PedidoNoEncontradoError,
  PedidoVacioError,
  TransicionInvalidaError,
  type ActorCaptura,
} from "@/lib/db-pedidos";
import { puedeCambiarEstatus, type CanalPedido } from "@/lib/pedidos";

// Lo que comparten las rutas /api/mostrador/*: la forma de las respuestas
// (`{ ok: true, ...datos }` / `{ ok: false, error }`), la lectura del cuerpo
// y del [id] de la ruta, y la traducción de los errores de dominio a códigos
// HTTP, para que cada ruta se quede con su lógica y nada más.

/** Todo lo que entra por estas rutas lo captura un vendedor en el mostrador. */
export const CANAL_MOSTRADOR: CanalPedido = "mostrador";

export const ERROR_SIN_BORRADOR = "No tienes un borrador abierto";
const ERROR_BASE = "No fue posible consultar la base de datos";

/** El borrador del vendedor se identifica por su usuario del POS. */
export function actorDe(sesion: SesionMostrador): ActorCaptura {
  return { tipo: "vendedor", usuario: sesion.usuario };
}

export function respuestaOk(datos: Record<string, unknown> = {}, status = 200): NextResponse {
  return NextResponse.json({ ok: true, ...datos }, { status });
}

export function respuestaError(error: string, status: number, extra: Record<string, unknown> = {}): NextResponse {
  return NextResponse.json({ ok: false, error, ...extra }, { status });
}

export type LecturaCuerpo = { ok: true; cuerpo: unknown } | { ok: false; respuesta: NextResponse };

/** Cuerpo JSON de la petición. Un cuerpo vacío vale como `{}`: varias rutas
 *  (enviar, DELETE) no necesitan datos y el cliente no tiene por qué mandarlos. */
export async function leerCuerpo(request: Request): Promise<LecturaCuerpo> {
  let texto: string;
  try {
    texto = await request.text();
  } catch {
    return { ok: false, respuesta: respuestaError("Petición inválida", 400) };
  }
  if (!texto.trim()) return { ok: true, cuerpo: {} };
  try {
    return { ok: true, cuerpo: JSON.parse(texto) };
  } catch {
    return { ok: false, respuesta: respuestaError("Petición inválida", 400) };
  }
}

/** El segmento numérico de la ruta ([id], [idPartida]) como entero positivo, o null. */
export async function idDeRuta(params: Promise<Record<string, string>>, clave: string): Promise<number | null> {
  return leerIdRuta((await params)[clave] ?? "");
}

/**
 * Traduce un error a la respuesta que le toca. Los de dominio ya traen el
 * mensaje para el usuario; cualquier otro es una falla de base o de código:
 * se loguea con el contexto de la ruta y sale como 502 sin detalles.
 */
export function respuestaDeError(error: unknown, contexto: string): NextResponse {
  if (error instanceof PedidoNoEncontradoError || error instanceof PartidaNoEncontradaError) {
    return respuestaError(error.message, 404);
  }
  if (error instanceof TransicionInvalidaError) {
    // Si un Administrador sí podría hacer el cambio, el problema es el perfil
    // de quien lo intenta (403); si nadie puede, la transición no existe (409).
    const esCuestionDePerfil = puedeCambiarEstatus("Administrador", error.de, error.a);
    return respuestaError(error.message, esCuestionDePerfil ? 403 : 409);
  }
  if (error instanceof PedidoVacioError || error instanceof PedidoNoEditableError) {
    return respuestaError(error.message, 409);
  }
  if (error instanceof LimitePedidoError) {
    return respuestaError(error.message, 400);
  }
  if (error instanceof TelefonoDuplicadoError) {
    return respuestaError(error.message, 409, { telefono: error.telefono, existente: error.existente });
  }
  if (error instanceof ReferenciaApvDuplicadaError) {
    return respuestaError(error.message, 409);
  }
  console.error(`[mostrador] ${contexto}:`, error);
  return respuestaError(ERROR_BASE, 502);
}
