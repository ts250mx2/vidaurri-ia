import { consultaBdav } from "./db";
import {
  ordenarSugerencias,
  SUGERENCIAS_MAX,
  type CandidatoBdav,
  type CandidatoConMotivo,
  type SugerenciaBdav,
} from "./sugerencias-bdav";
import { tokensParaBuscar } from "./similitud-nombres";
import { normalizarTelefono } from "./telefono";

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

/** RFC genérico de "público en general": no identifica a nadie. */
const RFC_GENERICO = "XAXX010101000";
const COLUMNAS_CANDIDATO = `c.id, c.nombre, c.telefono, c.rfc, c.ciudad,
            IFNULL(c.descuento, 0) AS descuento, (c.activo + 0) AS activo`;
/** Candidatos por palabras del nombre: se traen de más y se ordenan en JS. */
const CANDIDATOS_POR_NOMBRE = 120;
const CANDIDATOS_POR_LLAVE = 5;
const CELULARES_A_BUSCAR = 3;
/** Manual: más resultados, porque el usuario ya acotó. */
const SUGERENCIAS_BUSQUEDA_MANUAL = 10;

interface FilaCandidato {
  id: number;
  nombre: string | null;
  telefono: string | null;
  rfc: string | null;
  ciudad: string | null;
  descuento: number;
  activo: number;
}

function aCandidato(fila: FilaCandidato): CandidatoBdav {
  const rfc = String(fila.rfc ?? "").trim().toUpperCase();
  return {
    id: Number(fila.id),
    nombre: String(fila.nombre ?? "").trim(),
    telefono: String(fila.telefono ?? ""),
    rfc: rfc || null,
    ciudad: String(fila.ciudad ?? "").trim() || null,
    descuento: Number(fila.descuento),
    activo: Number(fila.activo),
  };
}

async function candidatosPorTelefono(telefonoNormalizado: string): Promise<CandidatoBdav[]> {
  if (!/^\d{7,20}$/.test(telefonoNormalizado)) return [];
  const filas = await consultaBdav<FilaCandidato>(
    `SELECT ${COLUMNAS_CANDIDATO}
       FROM clientes c
      WHERE ${TELEFONO_LIMPIO} = ?
         OR ${TELEFONO_LIMPIO} LIKE ?
         OR (LENGTH(${TELEFONO_LIMPIO}) >= ${MIN_DIGITOS_GUARDADOS}
             AND ? LIKE CONCAT('%', ${TELEFONO_LIMPIO}))
      ORDER BY (c.activo + 0) DESC, c.id DESC
      LIMIT ${CANDIDATOS_POR_LLAVE}`,
    [telefonoNormalizado, `%${telefonoNormalizado}`, telefonoNormalizado]
  );
  return filas.map(aCandidato);
}

async function candidatosPorRfc(rfc: string): Promise<CandidatoBdav[]> {
  const limpio = rfc.trim().toUpperCase();
  if (!limpio || limpio === RFC_GENERICO) return [];
  const filas = await consultaBdav<FilaCandidato>(
    `SELECT ${COLUMNAS_CANDIDATO}
       FROM clientes c
      WHERE UPPER(TRIM(c.rfc)) = ?
      ORDER BY (c.activo + 0) DESC, c.id DESC
      LIMIT ${CANDIDATOS_POR_LLAVE}`,
    [limpio]
  );
  return filas.map(aCandidato);
}

/** Por palabras del nombre (la colación de bdav ya ignora mayúsculas y acentos). */
async function candidatosPorNombre(texto: string): Promise<CandidatoBdav[]> {
  const tokens = tokensParaBuscar(texto);
  if (tokens.length === 0) return [];
  const condiciones = tokens.map(() => "c.nombre LIKE ?").join(" OR ");
  const filas = await consultaBdav<FilaCandidato>(
    `SELECT ${COLUMNAS_CANDIDATO}
       FROM clientes c
      WHERE ${condiciones}
      LIMIT ${CANDIDATOS_POR_NOMBRE}`,
    tokens.map((t) => `%${t}%`)
  );
  return filas.map(aCandidato);
}

export interface ReferenciaSugerencias {
  /** Nombre en el padrón, contra el que se mide el parecido. */
  nombre: string;
  /** Celulares del padrón, nacionales de 10 dígitos. */
  telefonos: string[];
  rfc: string | null;
  /** Lo que tecleó el usuario para buscar a mano; si viene, manda sobre el nombre. */
  busqueda?: string;
}

/**
 * Candidatos del catálogo de bdav para relacionar un cliente del padrón: por
 * sus celulares, por su RFC y por las palabras de su nombre (o de lo que el
 * usuario busque a mano, que puede ser un nombre o un teléfono). SOLO LECTURA.
 */
export async function sugerirClientesBdav(referencia: ReferenciaSugerencias): Promise<SugerenciaBdav[]> {
  const busqueda = referencia.busqueda?.trim() ?? "";
  const consultas: Array<Promise<CandidatoConMotivo[]>> = [];
  const conMotivo = (motivo: CandidatoConMotivo["motivo"]) => (lista: CandidatoBdav[]) =>
    lista.map((candidato) => ({ candidato, motivo }));

  if (busqueda) {
    const telefono = normalizarTelefono(busqueda);
    if (/^[\d\s\-+().]+$/.test(busqueda) && telefono.length >= MIN_DIGITOS_GUARDADOS) {
      consultas.push(candidatosPorTelefono(telefono).then(conMotivo("celular")));
    } else {
      consultas.push(candidatosPorNombre(busqueda).then(conMotivo("nombre")));
    }
  } else {
    for (const telefono of referencia.telefonos.slice(0, CELULARES_A_BUSCAR)) {
      consultas.push(candidatosPorTelefono(telefono).then(conMotivo("celular")));
    }
    if (referencia.rfc) consultas.push(candidatosPorRfc(referencia.rfc).then(conMotivo("rfc")));
    consultas.push(candidatosPorNombre(referencia.nombre).then(conMotivo("nombre")));
  }

  const candidatos = (await Promise.all(consultas)).flat();
  // En la búsqueda manual el usuario ya acotó: se muestra lo que encontró
  // aunque el nombre no se parezca al del padrón.
  return busqueda
    ? ordenarSugerencias(candidatos, referencia.nombre, {
        maximo: SUGERENCIAS_BUSQUEDA_MANUAL,
        soloParecidos: false,
      })
    : ordenarSugerencias(candidatos, referencia.nombre, { maximo: SUGERENCIAS_MAX });
}

/** Un cliente del catálogo por id, para validar una relación antes de guardarla. SOLO LECTURA. */
export async function obtenerClienteBdav(id: number): Promise<CandidatoBdav | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  const filas = await consultaBdav<FilaCandidato>(
    `SELECT ${COLUMNAS_CANDIDATO} FROM clientes c WHERE c.id = ? LIMIT 1`,
    [id]
  );
  return filas[0] ? aCandidato(filas[0]) : null;
}

/**
 * RFC → clientes.id de bdav, solo para los RFC que tiene UN solo cliente: el
 * genérico XAXX010101000 y cualquier RFC repetido no identifican a nadie y se
 * dejan fuera. Sirve para ligar la lista importada con el catálogo. SOLO LECTURA.
 */
export async function idsBdavPorRfc(rfcs: string[]): Promise<Map<string, number>> {
  const unicos = [...new Set(rfcs.map((r) => r.trim().toUpperCase()).filter(Boolean))];
  const mapa = new Map<string, number>();
  if (unicos.length === 0) return mapa;

  // Placeholders explícitos: así funciona igual con query() y con execute().
  const marcadores = unicos.map(() => "?").join(", ");
  const filas = await consultaBdav<{ rfc: string; cuantos: number; id: number }>(
    `SELECT UPPER(TRIM(rfc)) AS rfc, COUNT(*) AS cuantos, MIN(id) AS id
       FROM clientes
      WHERE UPPER(TRIM(rfc)) IN (${marcadores})
      GROUP BY UPPER(TRIM(rfc))`,
    unicos
  );
  for (const fila of filas) {
    if (Number(fila.cuantos) === 1) mapa.set(String(fila.rfc), Number(fila.id));
  }
  return mapa;
}
