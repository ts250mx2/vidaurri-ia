import mysql from "mysql2/promise";
import { garantizarSoloLectura } from "@/lib/db";

// Pool de MySQL de la BODEGA USADO (sucursal de piezas usadas, base remota
// wwapvi_bd-usadas). Es un sistema aparte de bdav: piezas usadas (puertas,
// faros, calaveras...), sus ventas y su bitácora. Igual que bdav, SOLO LECTURA:
// el usuario MySQL es de solo lectura y aquí se rechaza todo lo que no sea lectura.

const globalConPool = globalThis as unknown as { __poolUsadas?: mysql.Pool };

function crearPool(): mysql.Pool {
  const {
    MYSQL_USADAS_SERVER,
    MYSQL_USADAS_PORT,
    MYSQL_USADAS_USER,
    MYSQL_USADAS_PASSWORD,
    MYSQL_USADAS_DATABASE,
  } = process.env;
  if (!MYSQL_USADAS_SERVER || !MYSQL_USADAS_USER || !MYSQL_USADAS_PASSWORD || !MYSQL_USADAS_DATABASE) {
    throw new Error(
      "Faltan variables de entorno de la Bodega Usado (MYSQL_USADAS_SERVER/USER/PASSWORD/DATABASE)."
    );
  }
  return mysql.createPool({
    host: MYSQL_USADAS_SERVER,
    port: Number(MYSQL_USADAS_PORT) || 3306,
    user: MYSQL_USADAS_USER,
    password: MYSQL_USADAS_PASSWORD,
    database: MYSQL_USADAS_DATABASE,
    waitForConnections: true,
    // Servidor remoto compartido: menos conexiones simultáneas que bdav.
    connectionLimit: 5,
    queueLimit: 0,
    connectTimeout: 15000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    dateStrings: true,
    decimalNumbers: true,
    multipleStatements: false,
  });
}

export function poolUsadas(): mysql.Pool {
  if (!globalConPool.__poolUsadas) {
    globalConPool.__poolUsadas = crearPool();
  }
  return globalConPool.__poolUsadas;
}

/** SELECT tipado contra la base de la Bodega Usado. Solo lectura. */
export async function consultaUsadas<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  garantizarSoloLectura(sql);
  const [filas] = await poolUsadas().query(sql, params);
  return filas as T[];
}
