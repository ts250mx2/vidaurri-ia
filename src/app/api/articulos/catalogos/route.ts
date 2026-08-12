import { NextResponse } from "next/server";
import { consultaBdav } from "@/lib/db";
import { sesionActual } from "@/lib/auth";

export const dynamic = "force-dynamic";

interface FilaLinea {
  id: number;
  linea: string;
}

interface FilaParte {
  id: number;
  parte: string;
}

interface FilaProveedor {
  id: number;
  nombre: string;
}

export async function GET() {
  const sesion = await sesionActual();
  if (!sesion) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  try {
    const [lineas, partes, proveedores] = await Promise.all([
      consultaBdav<FilaLinea>("SELECT id, linea FROM lineas ORDER BY linea ASC"),
      consultaBdav<FilaParte>("SELECT id, parte FROM partes ORDER BY parte ASC"),
      consultaBdav<FilaProveedor>("SELECT id, nombre FROM proveedores ORDER BY nombre ASC"),
    ]);

    return NextResponse.json({ lineas, partes, proveedores });
  } catch (error) {
    console.error("Error consultando catálogos de artículos:", error);
    return NextResponse.json(
      { error: "No fue posible consultar los catálogos" },
      { status: 502 }
    );
  }
}
