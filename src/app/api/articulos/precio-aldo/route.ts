import { NextResponse } from "next/server";
import { sesionActual } from "@/lib/auth";
import { precioAldo } from "@/lib/aldo";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const CODIGO_VALIDO = /^[A-Za-z0-9._-]{1,50}$/;

export async function GET(request: Request) {
  const sesion = await sesionActual();
  if (!sesion) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const codigo = (new URL(request.url).searchParams.get("codigo") ?? "").trim();
  if (!CODIGO_VALIDO.test(codigo)) {
    return NextResponse.json({ error: "Código inválido" }, { status: 400 });
  }

  try {
    const aldo = await precioAldo(codigo);
    return NextResponse.json(aldo);
  } catch (error) {
    console.error("Error consultando precio de Aldo:", error);
    return NextResponse.json({ encontrado: false });
  }
}
