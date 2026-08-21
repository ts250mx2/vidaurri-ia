import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { ahoraMonterrey, asegurarEsquema, poolConversaciones } from "./db-conversaciones";
import {
  condicionesBusqueda,
  type CapturaClienteDescuento,
  type ClienteDescuento,
} from "./clientes-descuento";

// Padrón de clientes con descuento del Vendedor IA (teléfono → nombre y % de
// descuento). Vive en BDVidaurriConversaciones, la única base donde esta
// aplicación escribe; la tabla se auto-crea desde db-conversaciones.ts. El
// catálogo de clientes de bdav NO se toca: solo se consulta para prellenar.

/** El teléfono ya existe en el padrón (UNIQUE ux_telefono). */
export class TelefonoDuplicadoError extends Error {
  readonly existente: ClienteDescuento | null;

  constructor(existente: ClienteDescuento | null) {
    super("Este teléfono ya está registrado");
    this.name = "TelefonoDuplicadoError";
    this.existente = existente;
  }
}

const COLUMNAS = `id, telefono, cliente, descuento,
       id_cliente_bdav AS idClienteBdav,
       creado_por AS creadoPor, creado_en AS creadoEn,
       actualizado_por AS actualizadoPor, actualizado_en AS actualizadoEn`;

const USUARIO_MAX = 50;

function aRegistro(fila: RowDataPacket): ClienteDescuento {
  return {
    id: Number(fila.id),
    telefono: String(fila.telefono),
    cliente: String(fila.cliente),
    descuento: Number(fila.descuento),
    idClienteBdav: fila.idClienteBdav == null ? null : Number(fila.idClienteBdav),
    creadoPor: fila.creadoPor == null ? null : String(fila.creadoPor),
    creadoEn: String(fila.creadoEn),
    actualizadoPor: fila.actualizadoPor == null ? null : String(fila.actualizadoPor),
    actualizadoEn: String(fila.actualizadoEn),
  };
}

function esDuplicado(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "ER_DUP_ENTRY"
  );
}

export interface FiltrosClientesDescuento {
  /** Parte del nombre o del teléfono. */
  busqueda?: string;
  pagina: number;
  porPagina: number;
}

export interface PaginaClientesDescuento {
  registros: ClienteDescuento[];
  total: number;
  descuentoPromedio: number;
  /** Altas del mes en curso (horario de Monterrey) dentro del filtro. */
  altasMes: number;
}

/** Página del padrón, altas más recientes primero, con totales del filtro. */
export async function listarClientesDescuento(
  filtros: FiltrosClientesDescuento
): Promise<PaginaClientesDescuento> {
  await asegurarEsquema();
  const pool = poolConversaciones();
  const { clausula, parametros } = condicionesBusqueda(filtros.busqueda ?? "");
  const mesActual = ahoraMonterrey().fecha.slice(0, 7);

  const [filas] = await pool.query<RowDataPacket[]>(
    `SELECT ${COLUMNAS}
       FROM clientes_descuento
      WHERE ${clausula}
      ORDER BY creado_en DESC, id DESC
      LIMIT ? OFFSET ?`,
    [...parametros, filtros.porPagina, (filtros.pagina - 1) * filtros.porPagina]
  );
  const [totales] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total,
            IFNULL(AVG(descuento), 0) AS descuentoPromedio,
            IFNULL(SUM(DATE_FORMAT(creado_en, '%Y-%m') = ?), 0) AS altasMes
       FROM clientes_descuento
      WHERE ${clausula}`,
    [mesActual, ...parametros]
  );

  return {
    registros: filas.map(aRegistro),
    total: Number(totales[0]?.total ?? 0),
    descuentoPromedio: Number(totales[0]?.descuentoPromedio ?? 0),
    altasMes: Number(totales[0]?.altasMes ?? 0),
  };
}

export async function obtenerClienteDescuento(id: number): Promise<ClienteDescuento | null> {
  await asegurarEsquema();
  const [filas] = await poolConversaciones().query<RowDataPacket[]>(
    `SELECT ${COLUMNAS} FROM clientes_descuento WHERE id = ?`,
    [id]
  );
  return filas.length > 0 ? aRegistro(filas[0]) : null;
}

/** Por teléfono YA normalizado (es la llave única del padrón). */
export async function obtenerClienteDescuentoPorTelefono(
  telefono: string
): Promise<ClienteDescuento | null> {
  await asegurarEsquema();
  const [filas] = await poolConversaciones().query<RowDataPacket[]>(
    `SELECT ${COLUMNAS} FROM clientes_descuento WHERE telefono = ?`,
    [telefono]
  );
  return filas.length > 0 ? aRegistro(filas[0]) : null;
}

/** Alta. Lanza TelefonoDuplicadoError si el teléfono ya está en el padrón. */
export async function crearClienteDescuento(
  datos: CapturaClienteDescuento,
  usuario: string
): Promise<ClienteDescuento> {
  await asegurarEsquema();
  const { momento } = ahoraMonterrey();
  const quien = usuario.slice(0, USUARIO_MAX);
  try {
    const [resultado] = await poolConversaciones().query<ResultSetHeader>(
      `INSERT INTO clientes_descuento
         (telefono, cliente, descuento, id_cliente_bdav,
          creado_por, creado_en, actualizado_por, actualizado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [datos.telefono, datos.cliente, datos.descuento, datos.idClienteBdav, quien, momento, quien, momento]
    );
    const creado = await obtenerClienteDescuento(resultado.insertId);
    if (!creado) throw new Error("El registro no se pudo leer después de crearlo");
    return creado;
  } catch (error) {
    if (esDuplicado(error)) {
      throw new TelefonoDuplicadoError(await obtenerClienteDescuentoPorTelefono(datos.telefono));
    }
    throw error;
  }
}

/** Edición. null si el id no existe; TelefonoDuplicadoError si el nuevo teléfono choca. */
export async function actualizarClienteDescuento(
  id: number,
  datos: CapturaClienteDescuento,
  usuario: string
): Promise<ClienteDescuento | null> {
  await asegurarEsquema();
  const { momento } = ahoraMonterrey();
  try {
    const [resultado] = await poolConversaciones().query<ResultSetHeader>(
      `UPDATE clientes_descuento
          SET telefono = ?, cliente = ?, descuento = ?, id_cliente_bdav = ?,
              actualizado_por = ?, actualizado_en = ?
        WHERE id = ?`,
      [
        datos.telefono,
        datos.cliente,
        datos.descuento,
        datos.idClienteBdav,
        usuario.slice(0, USUARIO_MAX),
        momento,
        id,
      ]
    );
    if (resultado.affectedRows === 0) return null;
    return obtenerClienteDescuento(id);
  } catch (error) {
    if (esDuplicado(error)) {
      throw new TelefonoDuplicadoError(await obtenerClienteDescuentoPorTelefono(datos.telefono));
    }
    throw error;
  }
}

/** Baja. false si el id no existía. */
export async function eliminarClienteDescuento(id: number): Promise<boolean> {
  await asegurarEsquema();
  const [resultado] = await poolConversaciones().query<ResultSetHeader>(
    `DELETE FROM clientes_descuento WHERE id = ?`,
    [id]
  );
  return resultado.affectedRows > 0;
}
