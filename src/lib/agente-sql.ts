import { poolBdav } from "@/lib/db";

// Ejecución acotada de SQL para el agente VIDA: el usuario MySQL del sistema
// tiene privilegios amplios, así que la restricción a solo-lectura se impone
// aquí — un solo SELECT, sobre una lista blanca de tablas de negocio, con tope
// de filas y de tiempo. Defensa en profundidad: allowlist de tablas +
// bloqueo de nombres sensibles + rechazo de cualquier verbo de escritura.

const MAX_FILAS = 200;
const TIMEOUT_MS = 20000;
const MAX_CARACTERES_RESULTADO = 12000;

// Tablas de negocio que VIDA puede leer. Se excluye a propósito `usuarios`
// (guarda claves en texto plano) y todo lo legacy/respaldo.
export const TABLAS_PERMITIDAS = new Set([
  "articulos",
  "lineas",
  "partes",
  "modelos",
  "art-mod",
  "codigos_alternos",
  "partes_usadas",
  "proveedores",
  "ventas",
  "detalle_venta",
  "venta_formapago",
  "forma_pago",
  "cotiza",
  "detalle_cotiza",
  "clientes",
  "pagos_ventas",
  "pagos_detalle",
  "pedidos",
  "detalle_pedido",
  "compras",
  "detalle_compra",
  "facturas_compras",
  "detalle_factura_compra",
  "devoluciones",
  "devoluciones_detalle",
  "mov_articulos",
  "back_order",
  "detalle_bko",
  "backorder_venta",
  "vendedores",
  "generales",
]);

// Palabras que nunca deben aparecer como token en una consulta de lectura
// (verbos de escritura y funciones peligrosas).
const PROHIBIDAS =
  /\b(insert|update|delete|drop|alter|create|truncate|replace|rename|grant|revoke|call|lock|unlock|load_file|outfile|dumpfile|into|sleep|benchmark|shutdown|kill|set|use|handler|do)\b/i;

// Nombres sensibles bloqueados en cualquier parte de la consulta: tablas de
// sistema, la tabla de usuarios y la columna de claves. Refuerza la allowlist
// por si un token se cuela en un FROM con comas o una subconsulta atípica.
const SENSIBLES = /\b(usuarios|clave_usr|password|contrasenia|information_schema|performance_schema|mysql|sys)\b/i;

export interface ResultadoSql {
  ok: boolean;
  /** JSON con filas (recortado) o mensaje de error apto para el modelo. */
  contenido: string;
}

/** Quita literales de texto respetando escapes de MySQL (\\' y '') para no
 *  confundir el contenido de una cadena con palabras clave del SQL. */
function sinLiterales(sql: string): string {
  return sql
    .replace(/'(?:[^'\\]|\\.|'')*'/g, "''")
    .replace(/"(?:[^"\\]|\\.|"")*"/g, '""');
}

/** Identificadores que siguen a FROM o JOIN (nombre de tabla, con o sin
 *  backticks y prefijo de esquema). Ignora subconsultas `FROM (`. */
function tablasReferenciadas(sql: string): string[] {
  const tablas: string[] = [];
  const re = /\b(?:from|join)\s+([`\w.]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    const bruto = m[1].replace(/`/g, "");
    // Descarta prefijo de esquema (bdav.articulos → articulos).
    const nombre = bruto.includes(".") ? bruto.split(".").pop()! : bruto;
    if (nombre) tablas.push(nombre.toLowerCase());
  }
  return tablas;
}

/** Nombres de CTE definidos en la consulta (WITH x AS (...), y AS (...)): son
 *  tablas derivadas legítimas, no tablas reales, así que se permiten. */
function nombresCte(sql: string): Set<string> {
  const nombres = new Set<string>();
  const re = /(?:\bwith\s+|,\s*)([`\w]+)\s+as\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    nombres.add(m[1].replace(/`/g, "").toLowerCase());
  }
  return nombres;
}

/** Valida que la consulta sea un único SELECT/CTE de lectura sobre tablas
 *  permitidas. Devuelve un mensaje de error o null si es válida. */
export function validarConsulta(sql: string): string | null {
  const limpia = sql.trim().replace(/;+\s*$/, "");
  if (!limpia) return "Consulta vacía";
  if (limpia.includes(";")) return "Solo se permite una consulta (sin ';')";
  if (!/^(select|with)\b/i.test(limpia)) return "Solo se permiten consultas SELECT";

  const desnuda = sinLiterales(limpia);
  if (PROHIBIDAS.test(desnuda)) {
    return "La consulta contiene palabras no permitidas: solo lectura (SELECT)";
  }
  if (SENSIBLES.test(desnuda)) {
    return "No puedo consultar esa información (tablas de sistema o de seguridad no están disponibles)";
  }

  // Toda tabla referenciada tras FROM/JOIN debe estar en la lista blanca o ser
  // un CTE definido en la misma consulta.
  const cte = nombresCte(desnuda);
  const tablas = tablasReferenciadas(desnuda);
  const noPermitida = tablas.find((t) => !TABLAS_PERMITIDAS.has(t) && !cte.has(t));
  if (noPermitida) {
    return `La tabla "${noPermitida}" no está disponible para consulta`;
  }
  return null;
}

/** Ejecuta un SELECT validado con tope de filas y timeout. */
export async function ejecutarConsultaAgente(sql: string): Promise<ResultadoSql> {
  const error = validarConsulta(sql);
  if (error) return { ok: false, contenido: JSON.stringify({ error }) };

  const limpia = sql.trim().replace(/;+\s*$/, "");
  // Envuelta en tabla derivada: respeta el LIMIT interno si existe y acota el
  // resultado aunque el modelo lo omita. MySQL 8 admite WITH en derivadas.
  const acotada = `SELECT * FROM (${limpia}) AS vida_sub LIMIT ${MAX_FILAS + 1}`;

  try {
    const [filas] = await poolBdav().query({ sql: acotada, timeout: TIMEOUT_MS });
    const lista = filas as Record<string, unknown>[];
    const truncadoFilas = lista.length > MAX_FILAS;
    const visibles = truncadoFilas ? lista.slice(0, MAX_FILAS) : lista;

    let contenido = JSON.stringify({
      filas: visibles,
      total: visibles.length,
      ...(truncadoFilas ? { nota: `Se muestran solo ${MAX_FILAS} filas; afina la consulta.` } : {}),
    });
    if (contenido.length > MAX_CARACTERES_RESULTADO) {
      contenido =
        contenido.slice(0, MAX_CARACTERES_RESULTADO) +
        `"]}  /* resultado recortado a ${MAX_CARACTERES_RESULTADO} caracteres; pide menos columnas o filas */`;
    }
    return { ok: true, contenido };
  } catch (err: unknown) {
    // Mensaje genérico al modelo: no filtra estructura interna en errores.
    const mensaje = err instanceof Error ? err.message : "";
    const esSintaxis = /sql syntax|unknown column|doesn't exist|unknown table/i.test(mensaje);
    return {
      ok: false,
      contenido: JSON.stringify({
        error: esSintaxis
          ? "La consulta tiene un error de sintaxis o una columna/tabla inexistente; revísala."
          : "No fue posible ejecutar la consulta.",
      }),
    };
  }
}
