import { consultaBdav } from "./db";

// Búsqueda de un cliente del catálogo de bdav por teléfono. SOLO LECTURA.
//
// bdav es MySQL 5.7 (sin REGEXP_REPLACE) y el teléfono está capturado a mano
// ('83 74 95 95', '14-77-74-64', '8180738073', '+52...'): se limpia en SQL con
// REPLACE anidados y se compara por terminación en los dos sentidos:
//   - bdav con lada (5218112345678) TERMINA con el nacional buscado;
//   - bdav con número local viejo de 8 dígitos (83749595) ES la terminación
//     del nacional buscado (8183749595).
// Son ~6.4k filas: el recorrido completo es barato y no hay índice que sirva.

const TELEFONO_LIMPIO =
  "REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(c.telefono, ' ', ''), '-', ''), '(', ''), ')', ''), '.', ''), '+', ''), '/', '')";

/** Un número guardado más corto que esto no identifica a nadie ('0', '123'). */
const MIN_DIGITOS_GUARDADOS = 7;
const MAX_COINCIDENCIAS = 5;

export interface ClienteBdav {
  id: number;
  nombre: string;
  /** Como está capturado en bdav, sin limpiar. */
  telefono: string;
  descuento: number;
  activo: number;
  /** false = empató por terminación (bdav tiene otra lada o un número local). */
  exacto: boolean;
}

export interface BusquedaClienteBdav {
  /** La mejor coincidencia (exacta > activa > más reciente), o null. */
  cliente: ClienteBdav | null;
  /** Cuántos clientes empataron (tope MAX_COINCIDENCIAS). */
  coincidencias: number;
}

/** Busca por teléfono YA normalizado (solo dígitos, nacional de 10 si es MX). */
export async function buscarClienteBdavPorTelefono(
  telefonoNormalizado: string
): Promise<BusquedaClienteBdav> {
  if (!/^\d{7,20}$/.test(telefonoNormalizado)) return { cliente: null, coincidencias: 0 };

  const filas = await consultaBdav<Omit<ClienteBdav, "exacto"> & { exacto: number }>(
    `SELECT c.id, c.nombre, c.telefono,
            IFNULL(c.descuento, 0) AS descuento,
            (c.activo + 0) AS activo,
            (${TELEFONO_LIMPIO} = ?) AS exacto
       FROM clientes c
      WHERE ${TELEFONO_LIMPIO} = ?
         OR ${TELEFONO_LIMPIO} LIKE ?
         OR (LENGTH(${TELEFONO_LIMPIO}) >= ${MIN_DIGITOS_GUARDADOS}
             AND ? LIKE CONCAT('%', ${TELEFONO_LIMPIO}))
      ORDER BY exacto DESC, (c.activo + 0) DESC, c.id DESC
      LIMIT ${MAX_COINCIDENCIAS}`,
    [telefonoNormalizado, telefonoNormalizado, `%${telefonoNormalizado}`, telefonoNormalizado]
  );

  const mejor = filas[0];
  if (!mejor) return { cliente: null, coincidencias: 0 };
  return {
    cliente: {
      id: Number(mejor.id),
      nombre: String(mejor.nombre ?? "").trim(),
      telefono: String(mejor.telefono ?? ""),
      descuento: Number(mejor.descuento),
      activo: Number(mejor.activo),
      exacto: Number(mejor.exacto) === 1,
    },
    coincidencias: filas.length,
  };
}
