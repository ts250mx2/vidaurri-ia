import mysql from "mysql2/promise";

// Bitácora de CONVERSACIONES del Vendedor IA (BDVidaurriConversaciones).
// ÚNICA base donde esta aplicación escribe: guarda los chats para consultarlos
// después desde un portal. Las bases de negocio (bdav, Bodega Usado) siguen
// siendo estrictamente de solo lectura.
//
// Modelo (separado por día, como pidió el negocio):
//   conversaciones          — header: 1 fila por teléfono + fecha + canal
//   conversacion_mensajes   — detalle: cada mensaje (cliente o vendedor)
//   clientes_descuento      — padrón teléfono → cliente y % de descuento
//                             (CRUD en db-clientes-descuento.ts)

const globalConPool = globalThis as unknown as {
  __poolConversaciones?: mysql.Pool;
  __esquemaConversaciones?: Promise<void>;
  __esquemaConversacionesVersion?: number;
};

// Súbela al agregar o cambiar tablas en TABLAS. En desarrollo el módulo se
// recarga pero globalThis persiste: sin este número, un esquema nuevo no se
// aplicaría hasta reiniciar el servidor.
const VERSION_ESQUEMA = 3;

const ZONA_HORARIA = "America/Monterrey";

function crearPool(): mysql.Pool {
  const { MYSQL_CONV_SERVER, MYSQL_CONV_USER, MYSQL_CONV_PASSWORD, MYSQL_CONV_DATABASE } =
    process.env;
  if (!MYSQL_CONV_SERVER || !MYSQL_CONV_USER || !MYSQL_CONV_PASSWORD || !MYSQL_CONV_DATABASE) {
    throw new Error(
      "Faltan variables de entorno de conversaciones (MYSQL_CONV_SERVER/USER/PASSWORD/DATABASE)."
    );
  }
  return mysql.createPool({
    host: MYSQL_CONV_SERVER,
    user: MYSQL_CONV_USER,
    password: MYSQL_CONV_PASSWORD,
    database: MYSQL_CONV_DATABASE,
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,
    connectTimeout: 15000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    dateStrings: true,
    decimalNumbers: true,
    multipleStatements: false,
    // Emojis de WhatsApp: la conexión debe ser utf8mb4.
    charset: "utf8mb4",
  });
}

export function poolConversaciones(): mysql.Pool {
  if (!globalConPool.__poolConversaciones) {
    globalConPool.__poolConversaciones = crearPool();
  }
  return globalConPool.__poolConversaciones;
}

// Esquema auto-creado en el primer uso (patrón portal-db de kyk-server-web):
// CREATE TABLE IF NOT EXISTS es idempotente y evita un paso manual de alta.
const TABLAS = [
  `CREATE TABLE IF NOT EXISTS conversaciones (
     id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
     telefono VARCHAR(20) NOT NULL,
     fecha DATE NOT NULL,
     canal VARCHAR(10) NOT NULL DEFAULT 'whatsapp',
     mensajes INT NOT NULL DEFAULT 0,
     iniciada_en DATETIME NOT NULL,
     ultima_en DATETIME NOT NULL,
     PRIMARY KEY (id),
     UNIQUE KEY ux_tel_fecha_canal (telefono, fecha, canal),
     KEY idx_fecha (fecha)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS conversacion_mensajes (
     id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
     id_conversacion BIGINT UNSIGNED NOT NULL,
     rol VARCHAR(10) NOT NULL COMMENT 'cliente | vendedor',
     mensaje TEXT NOT NULL,
     fotos TEXT NULL COMMENT 'JSON con URLs de las fotos enviadas (solo vendedor)',
     creado_en DATETIME NOT NULL,
     PRIMARY KEY (id),
     KEY idx_conversacion (id_conversacion),
     CONSTRAINT fk_msj_conversacion FOREIGN KEY (id_conversacion)
       REFERENCES conversaciones (id) ON DELETE CASCADE
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS clientes_descuento (
     id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
     telefono VARCHAR(20) NULL COMMENT 'Celular de WhatsApp: solo dígitos, nacional de 10 si es de México; NULL = sin celular',
     cliente VARCHAR(150) NOT NULL,
     descuento DECIMAL(5,2) NOT NULL COMMENT 'Porcentaje 0-100',
     rfc VARCHAR(13) NULL,
     telefono2 VARCHAR(60) NULL COMMENT 'Otros teléfonos, texto libre',
     email VARCHAR(120) NULL,
     id_cliente_apv INT UNSIGNED NULL COMMENT 'ID CLIENTE de la lista de clientes APV',
     id_cliente_bdav BIGINT UNSIGNED NULL COMMENT 'clientes.id en bdav si se prellenó del catálogo o se ligó por RFC',
     creado_por VARCHAR(50) NULL,
     creado_en DATETIME NOT NULL COMMENT 'Fecha de alta (America/Monterrey)',
     actualizado_por VARCHAR(50) NULL,
     actualizado_en DATETIME NOT NULL,
     PRIMARY KEY (id),
     UNIQUE KEY ux_telefono (telefono),
     UNIQUE KEY ux_id_apv (id_cliente_apv),
     KEY idx_cliente (cliente),
     KEY idx_rfc (rfc)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

// Cambios a clientes_descuento posteriores a su primera versión. CREATE TABLE IF
// NOT EXISTS no toca una tabla que ya existe, así que se revisa
// information_schema y se aplica solo lo que falte. Es MySQL 8: no hay ADD
// COLUMN IF NOT EXISTS, por eso la revisión va aparte del ALTER.
const COLUMNAS_NUEVAS_CLIENTES_DESCUENTO: Array<{ columna: string; alter: string }> = [
  {
    columna: "rfc",
    alter:
      "ALTER TABLE clientes_descuento ADD COLUMN rfc VARCHAR(13) NULL AFTER descuento, ADD KEY idx_rfc (rfc)",
  },
  {
    columna: "telefono2",
    alter:
      "ALTER TABLE clientes_descuento ADD COLUMN telefono2 VARCHAR(60) NULL COMMENT 'Otros teléfonos, texto libre' AFTER rfc",
  },
  {
    columna: "email",
    alter: "ALTER TABLE clientes_descuento ADD COLUMN email VARCHAR(120) NULL AFTER telefono2",
  },
  {
    columna: "id_cliente_apv",
    alter:
      "ALTER TABLE clientes_descuento ADD COLUMN id_cliente_apv INT UNSIGNED NULL COMMENT 'ID CLIENTE de la lista de clientes APV' AFTER email, ADD UNIQUE KEY ux_id_apv (id_cliente_apv)",
  },
];

async function migrarClientesDescuento(pool: mysql.Pool): Promise<void> {
  const [filas] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT COLUMN_NAME AS columna, IS_NULLABLE AS anulable
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'clientes_descuento'`
  );
  const existentes = new Map(filas.map((f) => [String(f.columna), String(f.anulable)]));

  // El celular dejó de ser obligatorio: la lista APV trae miles de clientes sin
  // él y tienen que estar en el padrón aunque WhatsApp no los identifique.
  // UNIQUE admite varios NULL: la llave sigue valiendo para los que sí lo tienen.
  if (existentes.get("telefono") === "NO") {
    await pool.query(
      "ALTER TABLE clientes_descuento MODIFY telefono VARCHAR(20) NULL COMMENT 'Celular de WhatsApp: solo dígitos, nacional de 10 si es de México; NULL = sin celular'"
    );
  }
  for (const { columna, alter } of COLUMNAS_NUEVAS_CLIENTES_DESCUENTO) {
    if (!existentes.has(columna)) await pool.query(alter);
  }
}

export function asegurarEsquema(): Promise<void> {
  if (
    !globalConPool.__esquemaConversaciones ||
    globalConPool.__esquemaConversacionesVersion !== VERSION_ESQUEMA
  ) {
    globalConPool.__esquemaConversacionesVersion = VERSION_ESQUEMA;
    globalConPool.__esquemaConversaciones = (async () => {
      for (const sql of TABLAS) {
        await poolConversaciones().query(sql);
      }
      await migrarClientesDescuento(poolConversaciones());
    })().catch((error) => {
      // Si falló, se permite reintentar en la siguiente llamada.
      globalConPool.__esquemaConversaciones = undefined;
      throw error;
    });
  }
  return globalConPool.__esquemaConversaciones;
}

/** Fecha 'AAAA-MM-DD' y hora 'AAAA-MM-DD HH:MM:SS' en horario de Monterrey,
 *  sin depender de la zona horaria del servidor (suele ser UTC). */
export function ahoraMonterrey(): { fecha: string; momento: string } {
  const ahora = new Date();
  const fecha = ahora.toLocaleDateString("sv-SE", { timeZone: ZONA_HORARIA });
  const momento = ahora.toLocaleString("sv-SE", { timeZone: ZONA_HORARIA });
  return { fecha, momento };
}

export interface IntercambioConversacion {
  telefono: string;
  canal?: "whatsapp" | "web";
  mensajeCliente: string;
  respuestaVendedor: string;
  /** URLs de las fotos que se adjuntaron a la respuesta (si hubo). */
  fotos?: string[];
}

/**
 * Guarda un intercambio (mensaje del cliente + respuesta del vendedor) en la
 * bitácora. El header agrupa por teléfono y día; el detalle lleva cada mensaje.
 * Los errores se propagan: quien llama decide si es fatal (para el canal de
 * WhatsApp NO lo es: la respuesta al cliente nunca se bloquea por la bitácora).
 */
export async function guardarIntercambio(intercambio: IntercambioConversacion): Promise<void> {
  await asegurarEsquema();
  const pool = poolConversaciones();
  const { fecha, momento } = ahoraMonterrey();
  const canal = intercambio.canal ?? "whatsapp";
  const telefono = intercambio.telefono.slice(0, 20);

  // Header del día: crea o reutiliza la conversación (telefono, fecha, canal).
  // LAST_INSERT_ID(id) en el UPDATE hace que insertId traiga el id existente.
  const [resultado] = await pool.query<mysql.ResultSetHeader>(
    `INSERT INTO conversaciones (telefono, fecha, canal, mensajes, iniciada_en, ultima_en)
     VALUES (?, ?, ?, 2, ?, ?)
     ON DUPLICATE KEY UPDATE
       id = LAST_INSERT_ID(id),
       mensajes = mensajes + 2,
       ultima_en = VALUES(ultima_en)`,
    [telefono, fecha, canal, momento, momento]
  );
  const idConversacion = resultado.insertId;

  const fotos =
    intercambio.fotos && intercambio.fotos.length > 0 ? JSON.stringify(intercambio.fotos) : null;
  await pool.query(
    `INSERT INTO conversacion_mensajes (id_conversacion, rol, mensaje, fotos, creado_en)
     VALUES (?, 'cliente', ?, NULL, ?), (?, 'vendedor', ?, ?, ?)`,
    [
      idConversacion,
      intercambio.mensajeCliente.slice(0, 4000),
      momento,
      idConversacion,
      intercambio.respuestaVendedor.slice(0, 8000),
      fotos,
      momento,
    ]
  );
}

// ---------------------------------------------------------------------------
// LECTURA de la bitácora (portal de conversaciones del dashboard).
//
// El chat de la página pública entra al webservice con un "teléfono" sintético
// que empieza en 77 (lo genera vidaurri-page/src/app/api/chat). Las filas
// viejas quedaron guardadas con canal 'whatsapp' aunque vinieran de la web,
// así que el canal REAL se deriva también del patrón del teléfono — con el
// mismo regex que usa la página para validar sus sesiones.
// ---------------------------------------------------------------------------

/** Patrón (en SQL) de las sesiones sintéticas del chat web. */
const PATRON_SESION_WEB = "^77[0-9]{10,17}$";
/** Gemelo en JS del patrón de arriba, para clasificar al guardar. */
export const ES_SESION_WEB = /^77\d{10,17}$/;

// Celular nacional de 10 dígitos a partir de cómo lo guarda la bitácora, para
// cruzarlo con el padrón de clientes con descuento (que guarda 10 dígitos). Las
// pasarelas de WhatsApp mandan 5218112345678 o +5218112345678, a veces sin el
// 1; las sesiones del chat web (77…, 17-19 dígitos) no casan con nada, que es
// lo correcto. Es la misma regla que aplica normalizarTelefono en JS para las
// formas que llegan por WhatsApp.
const TELEFONO_NACIONAL = `CASE
  WHEN c.telefono REGEXP '^[+]?521[0-9]{10}$' THEN RIGHT(c.telefono, 10)
  WHEN c.telefono REGEXP '^[+]?52[0-9]{10}$' THEN RIGHT(c.telefono, 10)
  WHEN c.telefono REGEXP '^[0-9]{10}$' THEN c.telefono
  ELSE NULL END`;
const JOIN_PADRON = `LEFT JOIN clientes_descuento cd ON cd.telefono = ${TELEFONO_NACIONAL}`;

const CANAL_REAL = `CASE
  WHEN c.canal = 'web' OR c.telefono REGEXP '${PATRON_SESION_WEB}' THEN 'web'
  ELSE c.canal
END`;

export interface FiltrosConversaciones {
  /** Rango de fechas YYYY-MM-DD (inclusive). */
  desde: string;
  hasta: string;
  /** Búsqueda parcial por teléfono (solo dígitos). */
  telefono?: string;
  canal?: "whatsapp" | "web";
  pagina: number;
  porPagina: number;
}

export interface ConversacionResumen {
  id: number;
  telefono: string;
  /** Nombre del cliente en el padrón de clientes con descuento cuando su
   *  celular está dado de alta; null = teléfono sin dar de alta (o chat web). */
  cliente: string | null;
  fecha: string;
  canal: string;
  mensajes: number;
  iniciadaEn: string;
  ultimaEn: string;
  /** Primer mensaje del cliente, para reconocer la conversación en la lista. */
  primerMensaje: string | null;
}

export interface PaginaConversaciones {
  conversaciones: ConversacionResumen[];
  total: number;
  totalMensajes: number;
  porCanal: { whatsapp: number; web: number };
}

interface CondicionesArmadas {
  clausula: string;
  parametros: (string | number)[];
}

function armarCondiciones(filtros: FiltrosConversaciones): CondicionesArmadas {
  const condiciones = ["c.fecha BETWEEN ? AND ?"];
  const parametros: (string | number)[] = [filtros.desde, filtros.hasta];

  if (filtros.telefono) {
    // Solo dígitos y como parámetro: el % lo ponemos nosotros, no el usuario.
    condiciones.push("c.telefono LIKE ?");
    parametros.push(`%${filtros.telefono.replace(/\D/g, "")}%`);
  }
  if (filtros.canal) {
    condiciones.push(`${CANAL_REAL} = ?`);
    parametros.push(filtros.canal);
  }
  return { clausula: condiciones.join(" AND "), parametros };
}

/** Página de conversaciones más recientes primero, con totales del filtro. */
export async function listarConversaciones(
  filtros: FiltrosConversaciones
): Promise<PaginaConversaciones> {
  await asegurarEsquema();
  const pool = poolConversaciones();
  const { clausula, parametros } = armarCondiciones(filtros);

  const [filas] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT c.id, c.telefono, cd.cliente AS cliente, c.fecha, ${CANAL_REAL} AS canal, c.mensajes,
            c.iniciada_en AS iniciadaEn, c.ultima_en AS ultimaEn,
            (SELECT m.mensaje FROM conversacion_mensajes m
              WHERE m.id_conversacion = c.id AND m.rol = 'cliente'
              ORDER BY m.id LIMIT 1) AS primerMensaje
       FROM conversaciones c
       ${JOIN_PADRON}
      WHERE ${clausula}
      ORDER BY c.ultima_en DESC, c.id DESC
      LIMIT ? OFFSET ?`,
    [...parametros, filtros.porPagina, (filtros.pagina - 1) * filtros.porPagina]
  );

  const [totales] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(c.mensajes), 0) AS totalMensajes,
            COALESCE(SUM(CASE WHEN ${CANAL_REAL} = 'web' THEN 1 ELSE 0 END), 0) AS web
       FROM conversaciones c
      WHERE ${clausula}`,
    parametros
  );

  const total = Number(totales[0]?.total ?? 0);
  const web = Number(totales[0]?.web ?? 0);
  return {
    conversaciones: filas as ConversacionResumen[],
    total,
    totalMensajes: Number(totales[0]?.totalMensajes ?? 0),
    porCanal: { whatsapp: total - web, web },
  };
}

export interface MensajeConversacionGuardado {
  id: number;
  rol: "cliente" | "vendedor";
  mensaje: string;
  fotos: string[];
  creadoEn: string;
}

export interface DetalleConversacion {
  conversacion: ConversacionResumen;
  mensajes: MensajeConversacionGuardado[];
}

/** Una conversación completa, mensajes en orden cronológico. */
export async function obtenerConversacion(id: number): Promise<DetalleConversacion | null> {
  await asegurarEsquema();
  const pool = poolConversaciones();

  const [cabeceras] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT c.id, c.telefono, cd.cliente AS cliente, c.fecha, ${CANAL_REAL} AS canal, c.mensajes,
            c.iniciada_en AS iniciadaEn, c.ultima_en AS ultimaEn,
            NULL AS primerMensaje
       FROM conversaciones c
       ${JOIN_PADRON}
      WHERE c.id = ?`,
    [id]
  );
  if (cabeceras.length === 0) return null;

  const [filas] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT id, rol, mensaje, fotos, creado_en AS creadoEn
       FROM conversacion_mensajes
      WHERE id_conversacion = ?
      ORDER BY id`,
    [id]
  );

  const mensajes: MensajeConversacionGuardado[] = filas.map((fila) => {
    let fotos: string[] = [];
    if (fila.fotos) {
      try {
        const parseadas: unknown = JSON.parse(String(fila.fotos));
        if (Array.isArray(parseadas)) fotos = parseadas.map(String);
      } catch {
        // Un JSON corrupto no debe tirar la conversación entera: se muestra sin fotos.
      }
    }
    return {
      id: Number(fila.id),
      rol: fila.rol === "vendedor" ? "vendedor" : "cliente",
      mensaje: String(fila.mensaje),
      fotos,
      creadoEn: String(fila.creadoEn),
    };
  });

  return {
    conversacion: cabeceras[0] as ConversacionResumen,
    mensajes,
  };
}
