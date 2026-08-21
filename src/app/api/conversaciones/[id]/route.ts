import { NextResponse } from "next/server";
import { sesionActual } from "@/lib/auth";
import { obtenerConversacion } from "@/lib/db-conversaciones";

// Una conversación completa del Vendedor IA, mensaje por mensaje.

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const sesion = await sesionActual();
  if (!sesion) return new Response("No autorizado", { status: 401 });

  const { id } = await params;
  const idNumerico = Number.parseInt(id, 10);
  if (!Number.isInteger(idNumerico) || idNumerico <= 0) {
    return NextResponse.json({ error: "Identificador inválido" }, { status: 400 });
  }

  try {
    const detalle = await obtenerConversacion(idNumerico);
    if (!detalle) {
      return NextResponse.json({ error: "Conversación no encontrada" }, { status: 404 });
    }
    return NextResponse.json(detalle);
  } catch (error) {
    console.error("Error leyendo la conversación:", error);
    return NextResponse.json(
      { error: "No se pudo leer la conversación" },
      { status: 502 }
    );
  }
}
