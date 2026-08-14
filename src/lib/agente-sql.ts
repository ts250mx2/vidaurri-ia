import type mysql from "mysql2/promise";
import { poolBdav } from "@/lib/db";
import { poolUsadas } from "@/lib/db-usadas";

// Ejecución acotada de SQL para el agente VIDA: el usuario MySQL del sistema
// tiene privilegios amplios, así que la restricción a solo-lectura se impone
// aquí — un solo SELECT, sobre una lista blanca de tablas de negocio, con tope
// de filas y de tiempo. Defensa en profundidad: allowlist de tablas +
// bloqueo de nombres sensibles + rechazo de cualquier verbo de escritura.
// Aplica igual para bdav (matriz) y para la base de la Bodega Usado (sucursal
// de piezas usadas), cada una con su propia lista blanca.

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

// Tablas de negocio de la BODEGA USADO (wwapvi_bd-usadas). Se
// excluyen usuarios/perfiles/permisos/metodos (seguridad), los respaldos con
// fecha (…_11jul26, piezas_puertas_2jul26…), las tmp_* y control_folios.
export const TABLAS_PERMITIDAS_USADAS = new Set([
  "piezas",
  "partes",
  "marcas",
  "modelos",
  "nvos_modelos",
  "ubicaciones",
  "modulos",
  "lados_piezas",
  "posicion_piezas",
  "tipos_puertas",
  "compatibilidades",
  "autos_partes",
  "reglas_compatibilidad",
  "piezas_conectores",
  "piezas_imagenes",
  "piezas_ml",
  "piezas_ag",
  "proveedores",
  "ventas",
  "venta_detalle",
  "bitacora_piezas",
]);

// Palabras que nunca deben aparecer como token en una consulta de lectura
// (verbos de escritura y funciones peligrosas).
const PROHIBIDAS =
  /\b(insert|update|delete|drop|alter|create|truncate|replace|rename|grant|revoke|call|lock|unlock|load_file|outfile|dumpfile|into|sleep|benchmark|shutdown|kill|set|use|handler|do)\b/i;

// Nombres sensibles bloqueados en cualquier parte de la consulta: tablas de
// sistema, la tabla de usuarios y la columna de claves. Refuerza la allowlist
// por si un token se cuela en un FROM con comas o una subconsulta atípica.
const SENSIBLES = /\b(usuarios|clave_usr|clave_acceso|password|contrasenia|information_schema|performance_schema|mysql|sys)\b/i;

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
  // El guion en la clase permite nombres como `art-mod` (con backticks).
  const re = /\b(?:from|join|straight_join)\s+([`\w.-]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    const bruto = m[1].replace(/`/g, "");
    // Descarta prefijo de esquema (bdav.articulos → articulos).
    const nombre = bruto.includes(".") ? bruto.split(".").pop()! : bruto;
    if (nombre) tablas.push(nombre.toLowerCase());
  }
  return tablas;
}

// Palabras que terminan la lista de tablas de un FROM (inicia otra cláusula).
const FIN_LISTA_FROM = new Set([
  "where", "group", "order", "limit", "having", "union", "window", "for",
]);

/** Detecta joins estilo coma (`FROM a, b`): la extracción de tablas no los
 *  resuelve de forma fiable, así que se rechazan y el agente debe usar JOIN
 *  explícito. Recorre cada FROM saltando paréntesis balanceados (los FROM de
 *  subconsultas se revisan en su propia pasada del while). */
function tieneJoinConComa(sql: string): boolean {
  const re = /\bfrom\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    let profundidad = 0;
    for (let i = m.index + m[0].length; i < sql.length; i++) {
      const c = sql[i];
      if (c === "(") {
        profundidad++;
        continue;
      }
      if (c === ")") {
        if (profundidad === 0) break; // cierra el ámbito de este FROM
        profundidad--;
        continue;
      }
      if (profundidad > 0) continue;
      if (c === ",") return true;
      // ¿Inicia aquí una palabra clave que cierra la lista de tablas?
      if (/[a-zA-Z]/.test(c) && !/[\w`]/.test(sql[i - 1] ?? " ")) {
        const palabra = (sql.slice(i).match(/^[a-zA-Z_]+/) ?? [""])[0].toLowerCase();
        if (FIN_LISTA_FROM.has(palabra)) break;
      }
    }
  }
  return false;
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
export function validarConsulta(
  sql: string,
  permitidas: Set<string> = TABLAS_PERMITIDAS
): string | null {
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
  if (tieneJoinConComa(desnuda)) {
    return "No se permiten joins con coma (FROM a, b): usa JOIN ... ON explícito";
  }

  // Toda tabla referenciada tras FROM/JOIN debe estar en la lista blanca o ser
  // un CTE definido en la misma consulta.
  const cte = nombresCte(desnuda);
  const tablas = tablasReferenciadas(desnuda);
  const noPermitida = tablas.find((t) => !permitidas.has(t) && !cte.has(t));
  if (noPermitida) {
    return `La tabla "${noPermitida}" no está disponible para consulta`;
  }
  return null;
}

/** Ejecuta un SELECT validado con tope de filas y timeout sobre el pool dado. */
async function ejecutarSelectAcotado(
  pool: mysql.Pool,
  permitidas: Set<string>,
  sql: string
): Promise<ResultadoSql> {
  const error = validarConsulta(sql, permitidas);
  if (error) return { ok: false, contenido: JSON.stringify({ error }) };

  const limpia = sql.trim().replace(/;+\s*$/, "");
  // Envuelta en tabla derivada: respeta el LIMIT interno si existe y acota el
  // resultado aunque el modelo lo omita. MySQL 8 admite WITH en derivadas.
  const acotada = `SELECT * FROM (${limpia}) AS vida_sub LIMIT ${MAX_FILAS + 1}`;

  try {
    const [filas] = await pool.query({ sql: acotada, timeout: TIMEOUT_MS });
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

/** SELECT acotado del agente sobre bdav (matriz). */
export function ejecutarConsultaAgente(sql: string): Promise<ResultadoSql> {
  return ejecutarSelectAcotado(poolBdav(), TABLAS_PERMITIDAS, sql);
}

/** SELECT acotado del agente sobre la base de la Bodega Usado. */
export function ejecutarConsultaAgenteUsadas(sql: string): Promise<ResultadoSql> {
  return ejecutarSelectAcotado(poolUsadas(), TABLAS_PERMITIDAS_USADAS, sql);
}
