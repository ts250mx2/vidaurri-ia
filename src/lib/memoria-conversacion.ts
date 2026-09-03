import type { MensajeConversacion } from "@/lib/vendedor";

// Memoria de conversación en proceso para los canales que no traen historial
// en la petición (WhatsApp y el mostrador): un Map por instancia, con TTL de
// inactividad y tope de mensajes, para que Vico tenga contexto sin persistir
// nada. Cada endpoint crea la suya; las claves no se cruzan (teléfono en
// WhatsApp, m:<usuario> en el mostrador). Vive en el proceso, así que se
// pierde al reiniciar: es memoria de trabajo, la bitácora real está en
// BDVidaurriConversaciones.

/** Mensajes recordados por conversación. */
export const MAX_HISTORIAL = 12;
/** Inactividad tras la cual se olvida la conversación. */
export const TTL_CONVERSACION_MS = 30 * 60 * 1000;

export interface MemoriaConversacion {
  /** Historial vigente de la clave; vacío si no hay o ya expiró. */
  historialDe(clave: string): MensajeConversacion[];
  /** Anota pregunta y respuesta y renueva la expiración. */
  guardarTurno(clave: string, pregunta: string, respuesta: string): void;
  /** Empieza de cero (el cliente pidió reiniciar). */
  olvidar(clave: string): void;
}

export interface OpcionesMemoria {
  maxHistorial?: number;
  ttlMs?: number;
  /** Reloj inyectable para las pruebas. */
  ahora?: () => number;
}

export function crearMemoriaConversacion(opciones: OpcionesMemoria = {}): MemoriaConversacion {
  const maxHistorial = opciones.maxHistorial ?? MAX_HISTORIAL;
  const ttlMs = opciones.ttlMs ?? TTL_CONVERSACION_MS;
  const ahora = opciones.ahora ?? Date.now;
  const conversaciones = new Map<string, { mensajes: MensajeConversacion[]; expira: number }>();

  function historialDe(clave: string): MensajeConversacion[] {
    const conv = conversaciones.get(clave);
    if (!conv || conv.expira < ahora()) return [];
    return conv.mensajes;
  }

  function guardarTurno(clave: string, pregunta: string, respuesta: string): void {
    const previos = historialDe(clave);
    const mensajes = [
      ...previos,
      { rol: "usuario" as const, texto: pregunta },
      { rol: "agente" as const, texto: respuesta },
    ].slice(-maxHistorial);
    conversaciones.set(clave, { mensajes, expira: ahora() + ttlMs });
  }

  function olvidar(clave: string): void {
    conversaciones.delete(clave);
  }

  return { historialDe, guardarTurno, olvidar };
}
