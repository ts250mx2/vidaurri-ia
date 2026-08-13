// Consumo del stream NDJSON de los agentes (VIDA, Vendedor) en el navegador.

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

/**
 * Envía la pregunta a un endpoint de agente y va entregando la respuesta en
 * streaming (protocolo NDJSON). Devuelve el texto final.
 */
export async function preguntarAgente(
  endpoint: string,
  pregunta: string,
  historial: MensajeHistorial[],
  eventos: EventosAgente,
  señal?: AbortSignal,
  /** Modelo elegido en la interfaz (opcional; el servidor valida y cae al default). */
  modelo?: string
): Promise<string> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pregunta, historial, ...(modelo ? { modelo } : {}) }),
    signal: señal,
  });
  if (res.status === 401) throw new SesionExpiradaError();
  if (!res.ok || !res.body) {
    const json = await res.json().catch(() => null);
    throw new Error(json?.error || "El agente no pudo responder");
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

/** Atajo para el agente VIDA (con modelo elegible). */
export function preguntarVida(
  pregunta: string,
  historial: MensajeHistorial[],
  eventos: EventosAgente,
  señal?: AbortSignal,
  modelo?: string
): Promise<string> {
  return preguntarAgente("/api/chat/vida", pregunta, historial, eventos, señal, modelo);
}
