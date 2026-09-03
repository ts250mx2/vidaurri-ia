import { NextResponse } from "next/server";
import { AxonError } from "./axon";

// Traduce un fallo de Axon Logic a la respuesta de nuestra API: el motivo
// legible para el usuario y un status con el que la interfaz distinga "falta
// configurar" (503), "espera" (429) y "Axon no pudo" (502).

export function respuestaErrorAxon(error: unknown, accion: string): NextResponse {
  if (error instanceof AxonError) {
    const sinConfigurar = error.codigo === "sin_configurar";
    const status = sinConfigurar ? 503 : error.estado === 429 ? 429 : 502;
    return NextResponse.json(
      { error: `No se pudo ${accion}: ${error.motivo}`, sinConfigurar },
      { status }
    );
  }
  console.error(`Error al ${accion} en Axon Logic:`, error);
  return NextResponse.json({ error: `No se pudo ${accion}` }, { status: 502 });
}
