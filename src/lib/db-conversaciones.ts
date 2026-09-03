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
//   pedidos_mostrador       — pedidos para recoger en sucursal (mostrador,
//                             WhatsApp o web) con sus partidas y bitácora de
//                             eventos (capa de datos en db-pedidos.ts)

const globalConPool = globalThis as unknown as {
  __poolConversaciones?: mysql.Pool;
  __esquemaConversaciones?: Promise<void>;
  __esquemaConversacionesVersion?: number;
};

// Súbela al agregar o cambiar tablas en TABLAS. En desarrollo el módulo se
// recarga pero globalThis persiste: sin este número, un esquema nuevo no se
// aplicaría hasta reiniciar el servidor.
// v5: pedidos_mostrador, pedidos_mostrador_partidas y pedidos_mostrador_eventos
// (módulo de pedidos, fase 1).
const VERSION_ESQUEMA = 5;

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
     permitir_pedido TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = el cliente puede levantar pedidos',
     creado_por VARCHAR(50) NULL,
     creado_en DATETIME NOT NULL COMMENT 'Fecha de alta (America/Monterrey)',
     actualizado_por VARCHAR(50) NULL,
     actualizado_en DATETIME NOT NULL,
     PRIMARY KEY (id),
     UNIQUE KEY ux_id_apv (id_cliente_apv),
     KEY idx_telefono (telefono),
     KEY idx_cliente (cliente),
     KEY idx_rfc (rfc)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  // Un cliente puede tener varios celulares de WhatsApp. Esta tabla es la
  // llave única del padrón (un celular pertenece a UN cliente);
  // clientes_descuento.telefono es solo el principal, copia del primero.
  `CREATE TABLE IF NOT EXISTS clientes_descuento_telefonos (
     id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
     id_cliente BIGINT UNSIGNED NOT NULL,
     telefono VARCHAR(20) NOT NULL COMMENT 'Solo dígitos; nacional de 10 si es de México',
     creado_en DATETIME NOT NULL,
     PRIMARY KEY (id),
     UNIQUE KEY ux_telefono (telefono),
     KEY idx_cliente (id_cliente),
     CONSTRAINT fk_tel_cliente FOREIGN KEY (id_cliente)
       REFERENCES clientes_descuento (id) ON DELETE CASCADE
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  // Pedidos para recoger en sucursal. Van DESPUÉS de clientes_descuento porque
  // la FK del cliente exige que esa tabla ya exista. El folio se asigna al
  // pasar de borrador a enviado; mientras es borrador, clave_borrador dice de
  // quién es (v:<usuario> del POS o c:<telefono> del cliente).
  `CREATE TABLE IF NOT EXISTS pedidos_mostrador (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  folio VARCHAR(12) NULL COMMENT 'P-000131; se asigna al pasar de borrador a enviado',
  estatus VARCHAR(12) NOT NULL DEFAULT 'borrador' COMMENT 'borrador | enviado | confirmado | listo | entregado | cancelado',
  canal VARCHAR(10) NOT NULL COMMENT 'mostrador | whatsapp | web',
  clave_borrador VARCHAR(40) NULL COMMENT 'v:<usuario> (vendedor) o c:<telefono> (cliente) mientras es borrador; NULL después',
  id_cliente BIGINT UNSIGNED NULL COMMENT 'clientes_descuento.id; NULL = público general',
  cliente VARCHAR(150) NOT NULL COMMENT 'Nombre del cliente al momento del pedido (snapshot)',
  telefono VARCHAR(20) NULL COMMENT 'Celular del cliente, nacional 10 dígitos, si se conoce',
  descuento_pct DECIMAL(5,2) NOT NULL DEFAULT 0 COMMENT 'Descuento del padrón aplicado a las partidas nuevas',
  sucursal VARCHAR(10) NOT NULL DEFAULT 'matriz' COMMENT 'matriz | fierro (dónde recoge)',
  capturado_por VARCHAR(50) NULL COMMENT 'usuario del POS si lo capturó un vendedor; NULL si lo capturó el cliente',
  atendido_por VARCHAR(50) NULL COMMENT 'último usuario que cambió el estatus',
  subtotal DECIMAL(11,2) NOT NULL DEFAULT 0,
  iva DECIMAL(11,2) NOT NULL DEFAULT 0,
  total DECIMAL(11,2) NOT NULL DEFAULT 0 COMMENT 'IVA incluido; suma de importes',
  observaciones VARCHAR(500) NULL,
  folio_venta_pos VARCHAR(20) NULL COMMENT 'Folio de la venta en el POS al entregar (referencia, solo lectura)',
  motivo_cancelacion VARCHAR(200) NULL,
  creado_en DATETIME NOT NULL COMMENT 'America/Monterrey',
  enviado_en DATETIME NULL,
  confirmado_en DATETIME NULL,
  listo_en DATETIME NULL,
  entregado_en DATETIME NULL,
  cancelado_en DATETIME NULL,
  actualizado_en DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY ux_folio (folio),
  KEY idx_estatus (estatus),
  KEY idx_cliente (id_cliente),
  KEY idx_borrador (clave_borrador),
  KEY idx_creado (creado_en),
  CONSTRAINT fk_ped_cliente FOREIGN KEY (id_cliente) REFERENCES clientes_descuento (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS pedidos_mostrador_partidas (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_pedido BIGINT UNSIGNED NOT NULL,
  partida INT NOT NULL COMMENT 'Renglón 1..n',
  origen VARCHAR(12) NOT NULL COMMENT 'nueva | usada | sobre_pedido',
  codigo VARCHAR(20) NULL COMMENT 'articulos.codigo de bdav (nueva / sobre_pedido)',
  id_pieza_usada BIGINT UNSIGNED NULL COMMENT 'piezas.id_pieza de la Bodega Usado (usada)',
  descripcion VARCHAR(200) NOT NULL,
  cantidad INT NOT NULL,
  precio_unitario DECIMAL(11,2) NOT NULL COMMENT 'IVA incluido, ya con el descuento del cliente',
  importe DECIMAL(11,2) NOT NULL COMMENT 'cantidad * precio_unitario',
  existencia_al_pedir INT NULL COMMENT 'existencia en bdav/usadas al agregar',
  estatus_partida VARCHAR(16) NOT NULL DEFAULT 'pendiente' COMMENT 'pendiente | confirmada | sin_existencia | sobre_pedido',
  dias_entrega SMALLINT NULL COMMENT 'Solo sobre_pedido: días que promete el mostrador',
  nota VARCHAR(200) NULL COMMENT 'Nota del vendedor al confirmar',
  creado_en DATETIME NOT NULL,
  actualizado_en DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_pedido (id_pedido),
  CONSTRAINT fk_part_pedido FOREIGN KEY (id_pedido) REFERENCES pedidos_mostrador (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS pedidos_mostrador_eventos (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_pedido BIGINT UNSIGNED NOT NULL,
  evento VARCHAR(30) NOT NULL COMMENT 'creado | partida_agregada | partida_quitada | enviado | confirmado | listo | entregado | cancelado | nota',
  estatus_anterior VARCHAR(12) NULL,
  estatus_nuevo VARCHAR(12) NULL,
  detalle VARCHAR(500) NULL,
  usuario VARCHAR(50) NULL COMMENT 'usuario del POS o "cliente"',
  canal VARCHAR(10) NOT NULL COMMENT 'mostrador | whatsapp | web',
  creado_en DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_pedido (id_pedido),
  CONSTRAINT fk_ev_pedido FOREIGN KEY (id_pedido) REFERENCES pedidos_mostrador (id) ON DELETE CASCADE
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
  {
    columna: "permitir_pedido",
    alter:
      "ALTER TABLE clientes_descuento ADD COLUMN permitir_pedido TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = el cliente puede levantar pedidos' AFTER id_cliente_bdav",
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

  // Los celulares pasaron a clientes_descuento_telefonos. Se siembran desde el
  // principal los que falten, en cada arranque: es barato y se auto-repara si
  // el código anterior (que solo escribe el principal) dio de alta alguno
  // antes del despliegue.
  await pool.query(
    `INSERT IGNORE INTO clientes_descuento_telefonos (id_cliente, telefono, creado_en)
     SELECT c.id, c.telefono, c.creado_en
       FROM clientes_descuento c
      WHERE c.telefono IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM clientes_descuento_telefonos t
                         WHERE t.id_cliente = c.id AND t.telefono = c.telefono)`
  );

  // La unicidad del celular ya la garantiza la tabla de celulares; en el
  // principal estorba (al mover un celular de un cliente a otro chocaría con
  // la copia vieja). Queda un índice normal para las búsquedas.
  const [indices] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT 1 FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'clientes_descuento'
        AND INDEX_NAME = 'ux_telefono' LIMIT 1`
  );
  if (indices.length > 0) {
    await pool.query(
      "ALTER TABLE clientes_descuento DROP INDEX ux_telefono, ADD KEY idx_telefono (telefono)"
    );
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

/** Escritura atómica sobre BDVidaurriConversaciones: o entra todo el trabajo,
 *  o nada. Vive aquí porque la comparten el padrón de clientes con descuento y
 *  los pedidos de mostrador. */
export async function enTransaccion<T>(
  trabajo: (conexion: mysql.PoolConnection) => Promise<T>
): Promise<T> {
  const conexion = await poolConversaciones().getConnection();
  try {
    await conexion.beginTransaction();
    const resultado = await trabajo(conexion);
    await conexion.commit();
    return resultado;
  } catch (error) {
    await conexion.rollback();
    throw error;
  } finally {
    conexion.release();
  }
}

/** Fecha 'AAAA-MM-DD' y hora 'AAAA-MM-DD HH:MM:SS' en horario de Monterrey,
 *  sin depender de la zona horaria del servidor (suele ser UTC). */
export function ahoraMonterrey(): { fecha: string; momento: string } {
  const ahora = new Date();
  const fecha = ahora.toLocaleDateString("sv-SE", { timeZone: ZONA_HORARIA });
  const momento = ahora.toLocaleString("sv-SE", { timeZone: ZONA_HORARIA });
  return { fecha, momento };
}

/** Por dónde entró la conversación. 'mostrador' = Vico en modo vendedor desde
 *  el POS de vidaurri-page (el "teléfono" es m:<usuario>). */
export type CanalConversacion = "whatsapp" | "web" | "mostrador";

export interface IntercambioConversacion {
  telefono: string;
  canal?: CanalConversacion;
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
const JOIN_PADRON = `LEFT JOIN clientes_descuento_telefonos ct ON ct.telefono = ${TELEFONO_NACIONAL}
       LEFT JOIN clientes_descuento cd ON cd.id = ct.id_cliente`;

/** Con quién se habló: el cliente del padrón (todos sus celulares juntos) o,
 *  si no está dado de alta, el teléfono tal cual. */
const CLAVE_CONTACTO = `IFNULL(CONCAT('c', cd.id), CONCAT('t', c.telefono))`;

const CANAL_REAL = `CASE
  WHEN c.canal = 'web' OR c.telefono REGEXP '${PATRON_SESION_WEB}' THEN 'web'
  ELSE c.canal
END`;

/** Los comodines de LIKE que teclee el usuario se buscan literales. */
function escaparLike(texto: string): string {
  return texto.replace(/[\\%_]/g, "\\$&");
}

export interface FiltrosConversaciones {
  /** Rango de fechas YYYY-MM-DD (inclusive). */
  desde: string;
  hasta: string;
  /** Búsqueda parcial por teléfono (solo dígitos). */
  telefono?: string;
  /** Teléfono (si son dígitos) o nombre del cliente en el padrón. */
  busqueda?: string;
  /** Todas las conversaciones de un cliente del padrón (todos sus celulares). */
  idCliente?: number;
  /** Un teléfono exacto, tal como está en la bitácora. */
  telefonoExacto?: string;
  canal?: CanalConversacion;
  pagina: number;
  porPagina: number;
}

export interface ConversacionResumen {
  id: number;
  telefono: string;
  /** Nombre del cliente en el padrón de clientes con descuento cuando su
   *  celular está dado de alta; null = teléfono sin dar de alta (o chat web). */
  cliente: string | null;
  idCliente: number | null;
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
  porCanal: { whatsapp: number; web: number; mostrador: number };
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
  if (filtros.busqueda) {
    // Un número (con o sin separadores) busca en el teléfono; cualquier otro
    // texto busca en el nombre del padrón de clientes con descuento. Así un
    // dígito dentro de un nombre no empata medio padrón, y un teléfono a
    // medias no se compara contra nombres.
    const texto = filtros.busqueda.trim();
    const digitos = texto.replace(/\D/g, "");
    if (/^[\d\s\-+().]+$/.test(texto) && digitos) {
      condiciones.push("c.telefono LIKE ?");
      parametros.push(`%${digitos}%`);
    } else {
      condiciones.push("cd.cliente LIKE ?");
      parametros.push(`%${escaparLike(texto)}%`);
    }
  }
  if (filtros.idCliente != null) {
    condiciones.push("cd.id = ?");
    parametros.push(filtros.idCliente);
  }
  if (filtros.telefonoExacto) {
    condiciones.push("c.telefono = ?");
    parametros.push(filtros.telefonoExacto);
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
    `SELECT c.id, c.telefono, cd.cliente AS cliente, cd.id AS idCliente,
            c.fecha, ${CANAL_REAL} AS canal, c.mensajes,
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
            COALESCE(SUM(CASE WHEN ${CANAL_REAL} = 'web' THEN 1 ELSE 0 END), 0) AS web,
            COALESCE(SUM(CASE WHEN ${CANAL_REAL} = 'mostrador' THEN 1 ELSE 0 END), 0) AS mostrador
       FROM conversaciones c
       ${JOIN_PADRON}
      WHERE ${clausula}`,
    parametros
  );

  const total = Number(totales[0]?.total ?? 0);
  const web = Number(totales[0]?.web ?? 0);
  const mostrador = Number(totales[0]?.mostrador ?? 0);
  // WhatsApp es el resto: las filas viejas de la web quedaron con canal
  // 'whatsapp' y CANAL_REAL las reclasifica, así que no se cuenta por columna.
  return {
    conversaciones: filas as ConversacionResumen[],
    total,
    totalMensajes: Number(totales[0]?.totalMensajes ?? 0),
    porCanal: { whatsapp: total - web - mostrador, web, mostrador },
  };
}

export interface FiltrosContactos {
  desde: string;
  hasta: string;
  busqueda?: string;
  pagina: number;
  porPagina: number;
}

/** Con quién se habló por WhatsApp en el rango: un cliente del padrón (con
 *  todos sus celulares) o un teléfono sin dar de alta. */
export interface ContactoResumen {
  /** 'c<id>' para un cliente del padrón, 't<telefono>' para un teléfono suelto. */
  clave: string;
  idCliente: number | null;
  cliente: string | null;
  /** Teléfonos tal como están en la bitácora. */
  telefonos: string[];
  conversaciones: number;
  mensajes: number;
  primeraEn: string;
  ultimaEn: string;
}

export interface PaginaContactos {
  contactos: ContactoResumen[];
  total: number;
  conversaciones: number;
  mensajes: number;
  /** Cuántos de los contactos están dados de alta en el padrón. */
  clientes: number;
}

/** Conversaciones de WhatsApp agrupadas por contacto, las más recientes primero. */
export async function listarContactos(filtros: FiltrosContactos): Promise<PaginaContactos> {
  await asegurarEsquema();
  const pool = poolConversaciones();
  const { clausula, parametros } = armarCondiciones({ ...filtros, canal: "whatsapp" });

  const [filas] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT ${CLAVE_CONTACTO} AS clave, cd.id AS idCliente, cd.cliente AS cliente,
            GROUP_CONCAT(DISTINCT c.telefono ORDER BY c.telefono SEPARATOR ',') AS telefonos,
            COUNT(*) AS conversaciones, COALESCE(SUM(c.mensajes), 0) AS mensajes,
            MIN(c.iniciada_en) AS primeraEn, MAX(c.ultima_en) AS ultimaEn
       FROM conversaciones c
       ${JOIN_PADRON}
      WHERE ${clausula}
      GROUP BY clave, cd.id, cd.cliente
      ORDER BY ultimaEn DESC
      LIMIT ? OFFSET ?`,
    [...parametros, filtros.porPagina, (filtros.pagina - 1) * filtros.porPagina]
  );
  const [totales] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT COUNT(DISTINCT ${CLAVE_CONTACTO}) AS total,
            COUNT(*) AS conversaciones,
            COALESCE(SUM(c.mensajes), 0) AS mensajes,
            COUNT(DISTINCT cd.id) AS clientes
       FROM conversaciones c
       ${JOIN_PADRON}
      WHERE ${clausula}`,
    parametros
  );

  return {
    contactos: filas.map((f) => ({
      clave: String(f.clave),
      idCliente: f.idCliente == null ? null : Number(f.idCliente),
      cliente: f.cliente == null ? null : String(f.cliente),
      telefonos: String(f.telefonos ?? "").split(",").filter(Boolean),
      conversaciones: Number(f.conversaciones),
      mensajes: Number(f.mensajes),
      primeraEn: String(f.primeraEn),
      ultimaEn: String(f.ultimaEn),
    })),
    total: Number(totales[0]?.total ?? 0),
    conversaciones: Number(totales[0]?.conversaciones ?? 0),
    mensajes: Number(totales[0]?.mensajes ?? 0),
    clientes: Number(totales[0]?.clientes ?? 0),
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
    `SELECT c.id, c.telefono, cd.cliente AS cliente, cd.id AS idCliente,
            c.fecha, ${CANAL_REAL} AS canal, c.mensajes,
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
