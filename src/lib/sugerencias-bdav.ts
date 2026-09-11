// Sugerencias para relacionar un cliente del padrón con uno del catálogo de
// clientes de bdav: ordena y depura los candidatos que la capa de datos trae
// por celular, por RFC y por palabras del nombre. Lógica pura.

import { similitudNombres } from "./similitud-nombres";

/** Un cliente del catálogo de bdav, tal como se propone. */
export interface CandidatoBdav {
  id: number;
  nombre: string;
  /** Como está capturado en bdav, sin limpiar. */
  telefono: string;
  rfc: string | null;
  ciudad: string | null;
  descuento: number;
  activo: number;
}

/** Por qué se propone: mismo celular, mismo RFC o nombre parecido. */
export type MotivoSugerencia = "celular" | "rfc" | "nombre";

export interface SugerenciaBdav extends CandidatoBdav {
  /** Parecido del nombre con el del padrón, 0-100. */
  similitud: number;
  motivos: MotivoSugerencia[];
}

export interface CandidatoConMotivo {
  candidato: CandidatoBdav;
  motivo: MotivoSugerencia;
}

/** Parecido de nombre a partir del cual vale la pena proponer un candidato. */
export const SIMILITUD_MINIMA = 40;
export const SUGERENCIAS_MAX = 6;

const PESO_MOTIVO: Record<MotivoSugerencia, number> = { rfc: 2, celular: 1, nombre: 0 };

function pesoDe(motivos: MotivoSugerencia[]): number {
  return motivos.reduce((mayor, m) => Math.max(mayor, PESO_MOTIVO[m]), 0);
}

export interface OpcionesOrden {
  maximo?: number;
  /** false = no descarta por parecido (búsqueda manual: el usuario ya acotó). */
  soloParecidos?: boolean;
}

/**
 * Junta los candidatos repetidos (mismo id con varios motivos), calcula el
 * parecido del nombre y se queda con los que tienen un motivo fuerte (RFC o
 * celular) o un nombre suficientemente parecido. Orden: RFC, luego celular,
 * luego parecido, luego activos primero.
 */
export function ordenarSugerencias(
  candidatos: CandidatoConMotivo[],
  nombreReferencia: string,
  opciones: OpcionesOrden = {}
): SugerenciaBdav[] {
  const maximo = opciones.maximo ?? SUGERENCIAS_MAX;
  const soloParecidos = opciones.soloParecidos ?? true;
  const porId = new Map<number, SugerenciaBdav>();
  for (const { candidato, motivo } of candidatos) {
    const previo = porId.get(candidato.id);
    if (previo) {
      if (!previo.motivos.includes(motivo)) porId.set(candidato.id, { ...previo, motivos: [...previo.motivos, motivo] });
      continue;
    }
    const similitud = similitudNombres(nombreReferencia, candidato.nombre);
    const motivos: MotivoSugerencia[] = motivo === "nombre" || similitud < SIMILITUD_MINIMA ? [motivo] : [motivo, "nombre"];
    porId.set(candidato.id, { ...candidato, similitud, motivos });
  }

  return [...porId.values()]
    .filter((s) => !soloParecidos || pesoDe(s.motivos) > 0 || s.similitud >= SIMILITUD_MINIMA)
    .sort(
      (a, b) =>
        pesoDe(b.motivos) - pesoDe(a.motivos) ||
        b.similitud - a.similitud ||
        b.activo - a.activo ||
        b.id - a.id
    )
    .slice(0, maximo);
}
