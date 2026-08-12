import mysql from "mysql2/promise";

// Pool único de MySQL (bdav) reutilizado entre invocaciones de las API routes.
// En dev, Next recarga módulos: se guarda en globalThis para no fugar conexiones.

const globalConPool = globalThis as unknown as { __poolBdav?: mysql.Pool };

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
  });
}

export function poolBdav(): mysql.Pool {
  if (!globalConPool.__poolBdav) {
    globalConPool.__poolBdav = crearPool();
  }
  return globalConPool.__poolBdav;
}

/** SELECT tipado contra bdav con parámetros posicionales (?). */
export async function consultaBdav<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const [filas] = await poolBdav().query(sql, params);
  return filas as T[];
}
