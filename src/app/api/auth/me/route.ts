import { NextResponse } from "next/server";
import { sesionActual } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const sesion = await sesionActual();
  if (!sesion) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  return NextResponse.json({ usuario: sesion });
}
