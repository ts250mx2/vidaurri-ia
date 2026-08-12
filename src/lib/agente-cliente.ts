// Consumo del stream NDJSON del agente VIDA en el navegador.

export class SesionExpiradaError extends Error {
  constructor() {
    super("Tu sesión expiró; vuelve a iniciar sesión");
  }
}

export interface EventosAgente {
  /** Texto acumulado de la respuesta (ya con reinicios aplicados). */
  alTexto: (texto: string) => void;
  /** Estado de progreso ("Consultando ventas del día..."). */
  alEstado: (texto: string) => void;
}

interface MensajeHistorial {
  rol: "usuario" | "agente";
  texto: string;
}

/** Envía la pregunta y va entregando la respuesta en streaming. Devuelve el texto final. */
export async function preguntarVida(
  pregunta: string,
  historial: MensajeHistorial[],
  eventos: EventosAgente,
  señal?: AbortSignal
): Promise<string> {
  const res = await fetch("/api/chat/vida", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pregunta, historial }),
    signal: señal,
  });
  if (res.status === 401) throw new SesionExpiradaError();
  if (!res.ok || !res.body) {
    const json = await res.json().catch(() => null);
    throw new Error(json?.error || "VIDA no pudo responder");
  }

  const lector = res.body.getReader();
  const decodificador = new TextDecoder();
  let pendiente = "";
  let texto = "";
  let errorServidor = "";

  const procesar = (linea: string) => {
    const limpia = linea.trim();
    if (!limpia) return;
    let evento: { t?: string; texto?: string; error?: string };
    try {
      evento = JSON.parse(limpia);
    } catch {
      return; // línea corrupta: se ignora
    }
    switch (evento.t) {
      case "delta":
        texto += evento.texto ?? "";
        eventos.alTexto(texto);
        break;
      case "reinicio":
        texto = "";
        eventos.alTexto("");
        break;
      case "estado":
        eventos.alEstado(evento.texto ?? "");
        break;
      case "error":
        errorServidor = evento.error ?? "Error del agente";
        break;
    }
  };

  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    pendiente += decodificador.decode(value, { stream: true });
    const lineas = pendiente.split("\n");
    pendiente = lineas.pop() ?? "";
    lineas.forEach(procesar);
  }
  procesar(pendiente);

  if (errorServidor) throw new Error(errorServidor);
  return texto;
}
