import mysql from "mysql2/promise";

// Pool único de MySQL (bdav) reutilizado entre invocaciones de las API routes.
// En dev, Next recarga módulos: se guarda en globalThis para no fugar conexiones.

const globalConPool = globalThis as unknown as { __poolBdav?: mysql.Pool };

// ============================================================================
// APLICACIÓN DE SOLO LECTURA. Todas las consultas pasan por consultaBdav, y
// aquí se garantiza que únicamente sean de lectura: la app NUNCA inserta,
// actualiza ni borra en la base. Es la primera barrera (defensa en profundidad,
// junto con el usuario MySQL de solo lectura). No quitar sin una razón muy clara.
// ============================================================================

// La consulta debe EMPEZAR con un verbo de lectura.
const INICIO_LECTURA = /^\s*(select|with|show|describe|desc|explain)\b/i;

/** Lanza si el SQL no es de solo lectura. */
export function garantizarSoloLectura(sql: string): void {
  const limpia = sql.trim();
  if (!INICIO_LECTURA.test(limpia)) {
    throw new Error(
      "Consulta bloqueada: la aplicación es de solo lectura (solo se permiten consultas SELECT)."
    );
  }
  // Sobre el SQL sin literales de texto: ni siquiera un SELECT puede escribir a
  // disco (INTO OUTFILE/DUMPFILE). multipleStatements está desactivado, así que
  // tampoco se pueden apilar comandos con ';'.
  const sinLiterales = limpia
    .replace(/'(?:[^'\\]|\\.|'')*'/g, "''")
    .replace(/"(?:[^"\\]|\\.|"")*"/g, '""');
  if (/\binto\s+(outfile|dumpfile)\b/i.test(sinLiterales)) {
    throw new Error("Consulta bloqueada: no se permite escribir a disco.");
  }
}

function crearPool(): mysql.Pool {
  const { MYSQL_SERVER_SERVER, MYSQL_SERVER_USER, MYSQL_SERVER_PASSWORD, MYSQL_SERVER_DATABASE } =
    process.env;
  if (!MYSQL_SERVER_SERVER || !MYSQL_SERVER_USER || !MYSQL_SERVER_PASSWORD || !MYSQL_SERVER_DATABASE) {
    throw new Error(
      "Faltan variables de entorno de MySQL (MYSQL_SERVER_SERVER/USER/PASSWORD/DATABASE)."
    );
  }
  return mysql.createPool({
    host: MYSQL_SERVER_SERVER,
    user: MYSQL_SERVER_USER,
    password: MYSQL_SERVER_PASSWORD,
    database: MYSQL_SERVER_DATABASE,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    connectTimeout: 15000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    // Fechas como 'AAAA-MM-DD' y decimales como número: reportes, no contabilidad.
    dateStrings: true,
    decimalNumbers: true,
    // Nunca permitir apilar varios comandos en una sola llamada (anti-inyección).
    multipleStatements: false,
  });
}

export function poolBdav(): mysql.Pool {
  if (!globalConPool.__poolBdav) {
    globalConPool.__poolBdav = crearPool();
  }
  return globalConPool.__poolBdav;
}

/** SELECT tipado contra bdav con parámetros posicionales (?). Solo lectura. */
export async function consultaBdav<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  garantizarSoloLectura(sql);
  const [filas] = await poolBdav().query(sql, params);
  return filas as T[];
}
