import mysql from "mysql2/promise";
import { garantizarSoloLectura } from "@/lib/db";

// ============================================================================
// ÚNICA puerta de ESCRITURA hacia bdav, y es angosta a propósito.
//
// bdav es la base del punto de venta y esta aplicación la trata como de solo
// lectura (db.ts). La excepción, autorizada por el dueño el 3 sep 2026, es
// que un pedido de mostrador que ya está listo se refleje como cotización en
// el POS: INSERT en `cotiza`, INSERT en `detalle_cotiza` y UPDATE del estatus
// de `cotiza` para cancelarla. Nada más. Cada sentencia que pasa por aquí se
// coteja contra una lista blanca ANTES de mandarse; lo que no está en la lista
// no se ejecuta, aunque el usuario de MySQL tuviera permiso.
//
// Es un pool aparte de poolBdav (que sigue sin poder escribir) con su propio
// usuario (MYSQL_POS_ESCRITURA_*, que el dueño acotará a esos permisos en el
// servidor; mientras no exista se usa el de lectura). Dos capas: la lista
// blanca aquí y los GRANTs allá.
// ============================================================================

const globalConPool = globalThis as unknown as { __poolBdavEscritura?: mysql.Pool };

/** Es un canal para una cotización a la vez: no necesita más conexiones. */
const CONEXIONES_ESCRITURA = 2;
const PUERTO_MYSQL_DEFAULT = 3306;

/**
 * Lista blanca. Cada patrón está anclado al inicio y escrito en la forma
 * canónica exacta en la que el código de pos-cotiza.ts arma la sentencia
 * (mayúsculas, un espacio, paréntesis de columnas): cualquier variación se
 * rechaza. Es deliberadamente estricta; si hace falta otra sentencia se
 * agrega aquí, con el dueño enterado, no se relaja el patrón.
 */
const SENTENCIAS_PERMITIDAS: ReadonlyArray<{ nombre: string; patron: RegExp }> = [
  { nombre: "SELECT", patron: /^SELECT\b/ },
  { nombre: "INSERT INTO cotiza", patron: /^INSERT INTO cotiza \(/ },
  { nombre: "INSERT INTO detalle_cotiza", patron: /^INSERT INTO detalle_cotiza \(/ },
  { nombre: "UPDATE cotiza SET estatus", patron: /^UPDATE cotiza SET estatus = \? WHERE id = \?$/ },
];

/** Una sentencia que no está en la lista blanca. Se lanza SIN ejecutarla. */
export class EscrituraNoPermitidaError extends Error {
  readonly sql: string;

  constructor(sql: string) {
    super("Sentencia bloqueada: no está en la lista blanca de escritura al POS");
    this.name = "EscrituraNoPermitidaError";
    this.sql = sql;
  }
}

/** Espacios y saltos de línea de las plantillas multilínea, a uno solo. */
function normalizar(sql: string): string {
  return sql.trim().replace(/\s+/g, " ");
}

/**
 * Coteja UNA sentencia contra la lista blanca; lanza EscrituraNoPermitidaError
 * si no cabe. Pura, sin base: es lo que prueban los tests.
 *
 * Además de la lista: nada de ';' (multipleStatements ya está apagado en el
 * pool, pero así ni siquiera llega al driver) y los SELECT pasan también por
 * garantizarSoloLectura, que les prohíbe escribir a disco.
 */
export function validarSentenciaPos(sql: string): void {
  const limpia = normalizar(sql);
  if (limpia.includes(";")) throw new EscrituraNoPermitidaError(sql);
  const permitida = SENTENCIAS_PERMITIDAS.find(({ patron }) => patron.test(limpia));
  if (!permitida) throw new EscrituraNoPermitidaError(sql);
  if (permitida.nombre === "SELECT") garantizarSoloLectura(limpia);
}

function crearPool(): mysql.Pool {
  const {
    MYSQL_SERVER_SERVER,
    MYSQL_SERVER_PORT,
    MYSQL_SERVER_DATABASE,
    MYSQL_SERVER_USER,
    MYSQL_SERVER_PASSWORD,
    MYSQL_POS_ESCRITURA_USER,
    MYSQL_POS_ESCRITURA_PASSWORD,
  } = process.env;
  if (!MYSQL_SERVER_SERVER || !MYSQL_SERVER_DATABASE) {
    throw new Error("Faltan variables de entorno de MySQL (MYSQL_SERVER_SERVER/DATABASE).");
  }
  // El usuario acotado es opcional: mientras el dueño no lo cree se escribe
  // con el de siempre. Los dos valores van juntos: si falta uno de los de
  // escritura se cae al par de lectura completo, nunca se mezclan.
  const usuario = MYSQL_POS_ESCRITURA_USER && MYSQL_POS_ESCRITURA_PASSWORD ? MYSQL_POS_ESCRITURA_USER : MYSQL_SERVER_USER;
  const password =
    MYSQL_POS_ESCRITURA_USER && MYSQL_POS_ESCRITURA_PASSWORD ? MYSQL_POS_ESCRITURA_PASSWORD : MYSQL_SERVER_PASSWORD;
  if (!usuario || !password) {
    throw new Error("Faltan credenciales de MySQL para escribir en el POS (MYSQL_POS_ESCRITURA_* o MYSQL_SERVER_*).");
  }
  return mysql.createPool({
    host: MYSQL_SERVER_SERVER,
    port: Number(MYSQL_SERVER_PORT) || PUERTO_MYSQL_DEFAULT,
    user: usuario,
    password,
    database: MYSQL_SERVER_DATABASE,
    waitForConnections: true,
    connectionLimit: CONEXIONES_ESCRITURA,
    queueLimit: 0,
    connectTimeout: 15000,
    dateStrings: true,
    decimalNumbers: true,
    // Nunca apilar comandos en una llamada: la lista blanca valida UNA sentencia.
    multipleStatements: false,
  });
}

function poolBdavEscritura(): mysql.Pool {
  if (!globalConPool.__poolBdavEscritura) {
    globalConPool.__poolBdavEscritura = crearPool();
  }
  return globalConPool.__poolBdavEscritura;
}

/** Ejecuta una sentencia ya validada. Devuelve las filas (SELECT) o el
 *  ResultSetHeader (INSERT/UPDATE), que el llamador castea según lo que pidió. */
export type EjecutarPos = (sql: string, params?: unknown[]) => Promise<unknown>;

/** Lo que la transacción necesita de la conexión; así se prueba con una falsa. */
export interface ConexionPos {
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  query(sql: string, params?: unknown[]): Promise<[unknown, unknown]>;
}

/**
 * Corre `trabajo` dentro de una transacción sobre `conexion`. El `ejecutar`
 * que recibe el trabajo valida cada sentencia contra la lista blanca antes
 * de mandarla; si una no pasa, la transacción se deshace y el error sube.
 * Separada de enTransaccionPos para poder probarla sin base.
 */
export async function ejecutarTransaccionPos<T>(
  conexion: ConexionPos,
  trabajo: (ejecutar: EjecutarPos) => Promise<T>
): Promise<T> {
  const ejecutar: EjecutarPos = async (sql, params = []) => {
    validarSentenciaPos(sql);
    const [resultado] = await conexion.query(sql, params);
    return resultado;
  };
  await conexion.beginTransaction();
  try {
    const resultado = await trabajo(ejecutar);
    await conexion.commit();
    return resultado;
  } catch (error) {
    await conexion.rollback();
    throw error;
  }
}

/**
 * Escritura atómica al POS: o entra la cotización completa (cabecera y
 * renglones) o no entra nada. Toda sentencia pasa por la lista blanca.
 */
export async function enTransaccionPos<T>(trabajo: (ejecutar: EjecutarPos) => Promise<T>): Promise<T> {
  const conexion = await poolBdavEscritura().getConnection();
  try {
    return await ejecutarTransaccionPos(conexion, trabajo);
  } finally {
    conexion.release();
  }
}
