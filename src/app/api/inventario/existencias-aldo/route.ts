import { NextResponse } from "next/server";
import { sesionActual } from "@/lib/auth";
import { buscarAldo } from "@/lib/aldo";

// Búsqueda en el catálogo EN LÍNEA de Aldo Autopartes (scraping de
// pi_resultados.jsp, hasta 50 filas). Es una fuente externa: no hay
// paginación y los precios son de lista.

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Mismo alfabeto que los códigos de Aldo; evita mandar basura al sitio externo.
const TERMINO_VALIDO = /^[A-Za-z0-9._/-]{2,30}$/;

export async function GET(request: Request) {
  const sesion = await sesionActual();
  if (!sesion) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const termino = (new URL(request.url).searchParams.get("termino") ?? "").trim();
  if (!TERMINO_VALIDO.test(termino)) {
    return NextResponse.json(
      {
        resultados: [],
        error: "Término inválido: usa de 2 a 30 caracteres (letras, números, . _ / -)",
      },
      { status: 400 }
    );
  }

  try {
    const resultados = await buscarAldo(termino);
    return NextResponse.json({ resultados });
  } catch (error) {
    console.error("Error consultando el catálogo de Aldo:", error);
    return NextResponse.json({ resultados: [], error: "Aldo no respondió" }, { status: 502 });
  }
}
