import { NextResponse } from "next/server";
import { sesionActual } from "@/lib/auth";
import { validarCapturaClienteDescuento } from "@/lib/clientes-descuento";
import {
  actualizarClienteDescuento,
  eliminarClienteDescuento,
  TelefonoDuplicadoError,
} from "@/lib/db-clientes-descuento";

// Edición y baja de un cliente con descuento del Vendedor IA.

export const dynamic = "force-dynamic";

type Contexto = { params: Promise<{ id: string }> };

async function leerId(contexto: Contexto): Promise<number | null> {
  const { id } = await contexto.params;
  const numero = Number.parseInt(id, 10);
  return Number.isInteger(numero) && numero > 0 && String(numero) === id ? numero : null;
}

export async function PUT(request: Request, contexto: Contexto) {
  const sesion = await sesionActual();
  if (!sesion) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const id = await leerId(contexto);
  if (id == null) return NextResponse.json({ error: "Identificador inválido" }, { status: 400 });

  let cuerpo: unknown;
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Petición inválida" }, { status: 400 });
  }
  const validacion = validarCapturaClienteDescuento(cuerpo);
  if (!validacion.ok) return NextResponse.json({ error: validacion.error }, { status: 400 });

  try {
    const registro = await actualizarClienteDescuento(id, validacion.datos, sesion.usuario);
    if (!registro) {
      return NextResponse.json({ error: "El registro ya no existe" }, { status: 404 });
    }
    return NextResponse.json({ registro });
  } catch (error) {
    if (error instanceof TelefonoDuplicadoError) {
      return NextResponse.json(
        { error: error.message, existente: error.existente },
        { status: 409 }
      );
    }
    console.error(`Error actualizando el cliente con descuento ${id}:`, error);
    return NextResponse.json(
      { error: "No se pudo guardar el cliente con descuento" },
      { status: 502 }
    );
  }
}

export async function DELETE(_request: Request, contexto: Contexto) {
  const sesion = await sesionActual();
  if (!sesion) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const id = await leerId(contexto);
  if (id == null) return NextResponse.json({ error: "Identificador inválido" }, { status: 400 });

  try {
    const eliminado = await eliminarClienteDescuento(id);
    if (!eliminado) {
      return NextResponse.json({ error: "El registro ya no existe" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(`Error eliminando el cliente con descuento ${id}:`, error);
    return NextResponse.json(
      { error: "No se pudo eliminar el cliente con descuento" },
      { status: 502 }
    );
  }
}
