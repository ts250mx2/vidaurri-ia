import { sesionActual } from "@/lib/auth";
import { claveFaltante } from "@/lib/agente-modelo";
import { correrVendedor, type MensajeConversacion } from "@/lib/vendedor";

// Endpoint web del Vendedor IA (canal del dashboard). Streaming NDJSON:
//   {t:'delta', texto} {t:'reinicio'} {t:'estado', texto} {t:'fin'} {t:'error', error}

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_HISTORIAL = 12;
const MAX_PREGUNTA = 2000;

// Rate limit en memoria: 15 preguntas por minuto por usuario.
const ventanas = new Map<string, number[]>();
function excedeLimite(clave: string): boolean {
  const ahora = Date.now();
  const ventana = (ventanas.get(clave) ?? []).filter((t) => ahora - t < 60_000);
  if (ventana.length >= 15) return true;
  ventana.push(ahora);
  ventanas.set(clave, ventana);
  return false;
}

export async function POST(request: Request) {
  const sesion = await sesionActual();
  if (!sesion) return Response.json({ error: "No autorizado" }, { status: 401 });
  if (excedeLimite(`${sesion.id}:${sesion.usuario}`)) {
    return Response.json(
      { error: "Demasiadas preguntas seguidas; espera un momento" },
      { status: 429 }
    );
  }

  const modelo = process.env.VENDEDOR_MODELO || "claude-sonnet-5";
  const claveEnv = claveFaltante(modelo);
  if (claveEnv) {
    return Response.json({ error: `Falta configurar ${claveEnv} en el servidor` }, { status: 500 });
  }

  let cuerpo: { pregunta?: string; historial?: MensajeConversacion[] };
  try {
    cuerpo = await request.json();
  } catch {
    return Response.json({ error: "Petición inválida" }, { status: 400 });
  }
  const pregunta = String(cuerpo.pregunta ?? "").trim().slice(0, MAX_PREGUNTA);
  if (!pregunta) return Response.json({ error: "Escribe una pregunta" }, { status: 400 });
  const historial = (cuerpo.historial ?? []).slice(-MAX_HISTORIAL);

  const codificador = new TextEncoder();
  const stream = new ReadableStream({
    async start(controlador) {
      let viva = true;
      const emitir = (evento: Record<string, unknown>) => {
        if (!viva) return;
        try {
          controlador.enqueue(codificador.encode(JSON.stringify(evento) + "\n"));
        } catch {
          viva = false;
        }
      };

      try {
        await correrVendedor({
          pregunta,
          historial,
          modelo,
          canal: "web",
          alTexto: (fragmento) => emitir({ t: "delta", texto: fragmento }),
          alReinicio: () => emitir({ t: "reinicio" }),
          alEstado: (texto) => emitir({ t: "estado", texto }),
        });
        emitir({ t: "fin" });
      } catch (error) {
        console.error("Error en agente Vendedor IA (web):", error);
        emitir({ t: "error", error: "El Vendedor IA tuvo un problema; intenta de nuevo" });
      } finally {
        try {
          controlador.close();
        } catch {
          // ya cerrado
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
