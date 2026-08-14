import { NextResponse } from "next/server";
import { sesionActual } from "@/lib/auth";
import { consultaUsadas } from "@/lib/db-usadas";

// Catálogos de la Bodega Usado para los filtros del módulo Piezas Usadas.

export const dynamic = "force-dynamic";

export async function GET() {
  const sesion = await sesionActual();
  if (!sesion) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  try {
    const [partes, marcas] = await Promise.all([
      consultaUsadas<{ id: number; parte: string }>(
        "SELECT id_parte AS id, parte FROM partes WHERE parte <> '' ORDER BY parte"
      ),
      consultaUsadas<{ id: number; marca: string }>(
        "SELECT id_marca AS id, marca FROM marcas WHERE marca <> '' ORDER BY marca"
      ),
    ]);
    return NextResponse.json({ partes, marcas });
  } catch (error) {
    console.error("Error en catálogos de la Bodega Usado:", error);
    return NextResponse.json(
      { error: "No fue posible consultar la Bodega Usado" },
      { status: 502 }
    );
  }
}
