import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { ahoraMonterrey, asegurarEsquema, poolConversaciones } from "./db-conversaciones";
import {
  condicionesBusqueda,
  type CapturaClienteDescuento,
  type ClienteDescuento,
} from "./clientes-descuento";
import type { FilaImportacion } from "./importar-clientes-descuento";

// Padrón de clientes con descuento del Vendedor IA (celular → nombre y % de
// descuento, más RFC, otros teléfonos y email). Vive en
// BDVidaurriConversaciones, la única base donde esta aplicación escribe; la
// tabla se auto-crea y se migra desde db-conversaciones.ts. El catálogo de
// clientes de bdav NO se toca: solo se consulta para prellenar y ligar por RFC.

/** El celular ya existe en el padrón (UNIQUE ux_telefono). */
export class TelefonoDuplicadoError extends Error {
  readonly existente: ClienteDescuento | null;

  constructor(existente: ClienteDescuento | null) {
    super("Este celular ya está registrado");
    this.name = "TelefonoDuplicadoError";
    this.existente = existente;
  }
}

/** El ID de la lista APV ya está en otro registro (UNIQUE ux_id_apv). */
export class ReferenciaApvDuplicadaError extends Error {
  constructor() {
    super("Ese ID de cliente APV ya está en el padrón");
    this.name = "ReferenciaApvDuplicadaError";
  }
}

const COLUMNAS = `id, telefono, cliente, descuento, rfc, telefono2, email,
       id_cliente_apv AS idClienteApv, id_cliente_bdav AS idClienteBdav,
       creado_por AS creadoPor, creado_en AS creadoEn,
       actualizado_por AS actualizadoPor, actualizado_en AS actualizadoEn`;

const USUARIO_MAX = 50;
/** Filas por INSERT en la importación: pocas idas a una base remota. */
const LOTE_IMPORTACION = 300;

const texto = (valor: unknown): string | null => (valor == null ? null : String(valor));
const numero = (valor: unknown): number | null => (valor == null ? null : Number(valor));

function aRegistro(fila: RowDataPacket): ClienteDescuento {
  return {
    id: Number(fila.id),
    telefono: texto(fila.telefono),
    cliente: String(fila.cliente),
    descuento: Number(fila.descuento),
    rfc: texto(fila.rfc),
    telefono2: texto(fila.telefono2),
    email: texto(fila.email),
    idClienteApv: numero(fila.idClienteApv),
    idClienteBdav: numero(fila.idClienteBdav),
    creadoPor: texto(fila.creadoPor),
    creadoEn: String(fila.creadoEn),
    actualizadoPor: texto(fila.actualizadoPor),
    actualizadoEn: String(fila.actualizadoEn),
  };
}

/** Qué llave única chocó, o null si el error no es de duplicado. */
function llaveDuplicada(error: unknown): "ux_telefono" | "ux_id_apv" | null {
  if (typeof error !== "object" || error === null) return null;
  const { code, sqlMessage } = error as { code?: string; sqlMessage?: string };
  if (code !== "ER_DUP_ENTRY") return null;
  return sqlMessage?.includes("ux_id_apv") ? "ux_id_apv" : "ux_telefono";
}

/** Traduce el ER_DUP_ENTRY de MySQL al error de dominio que corresponda. */
async function relanzarDuplicado(error: unknown, datos: CapturaClienteDescuento): Promise<never> {
  const llave = llaveDuplicada(error);
  if (llave === "ux_id_apv") throw new ReferenciaApvDuplicadaError();
  if (llave === "ux_telefono") {
    throw new TelefonoDuplicadoError(
      datos.telefono ? await obtenerClienteDescuentoPorTelefono(datos.telefono) : null
    );
  }
  throw error;
}

export interface FiltrosClientesDescuento {
  /** Parte del nombre, teléfono, RFC o email. */
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

/** Por celular YA normalizado (es la llave única del padrón). */
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

/** Alta. Lanza TelefonoDuplicadoError o ReferenciaApvDuplicadaError si chocan. */
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
         (telefono, cliente, descuento, rfc, telefono2, email,
          id_cliente_apv, id_cliente_bdav,
          creado_por, creado_en, actualizado_por, actualizado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        datos.telefono,
        datos.cliente,
        datos.descuento,
        datos.rfc,
        datos.telefono2,
        datos.email,
        datos.idClienteApv,
        datos.idClienteBdav,
        quien,
        momento,
        quien,
        momento,
      ]
    );
    const creado = await obtenerClienteDescuento(resultado.insertId);
    if (!creado) throw new Error("El registro no se pudo leer después de crearlo");
    return creado;
  } catch (error) {
    return relanzarDuplicado(error, datos);
  }
}

/** Edición. null si el id no existe; error de duplicado si el celular o el ID APV chocan. */
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
          SET telefono = ?, cliente = ?, descuento = ?, rfc = ?, telefono2 = ?, email = ?,
              id_cliente_apv = ?, id_cliente_bdav = ?,
              actualizado_por = ?, actualizado_en = ?
        WHERE id = ?`,
      [
        datos.telefono,
        datos.cliente,
        datos.descuento,
        datos.rfc,
        datos.telefono2,
        datos.email,
        datos.idClienteApv,
        datos.idClienteBdav,
        usuario.slice(0, USUARIO_MAX),
        momento,
        id,
      ]
    );
    if (resultado.affectedRows === 0) return null;
    return obtenerClienteDescuento(id);
  } catch (error) {
    return relanzarDuplicado(error, datos);
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

export interface CelularRepetido {
  linea: number;
  idClienteApv: number;
  cliente: string;
  telefono: string;
  /** Nombre del cliente que ya tenía ese celular en el padrón. */
  asignadoA: string;
}

export interface ResumenImportacion {
  total: number;
  insertados: number;
  actualizados: number;
  /** Registros que quedaron sin celular (no traían uno válido o ya era de otro). */
  sinCelular: number;
  celularRepetido: CelularRepetido[];
}

/** Lo que se sabe de un registro del padrón durante la importación. */
interface Dueno {
  /** Negativo = fila que se insertará en esta misma corrida (aún sin id). */
  id: number;
  cliente: string;
}

/**
 * Importa la lista de clientes APV. Es idempotente por ID CLIENTE: si el ID ya
 * está en el padrón se actualizan sus datos, si no se inserta. El celular es
 * llave única, y en la lista real 46 números están repetidos entre clientes
 * distintos (mismo dueño con dos razones sociales, familiares…): el primero
 * que aparece se lo queda y los demás entran SIN celular, reportados, para que
 * una persona decida a quién pertenece. Nada se descarta en silencio.
 *
 * Todo va en una transacción: o entra la lista completa o no entra nada.
 */
export async function importarClientesDescuento(
  filas: FilaImportacion[],
  usuario: string
): Promise<ResumenImportacion> {
  await asegurarEsquema();
  const { momento } = ahoraMonterrey();
  const quien = `importación CSV · ${usuario}`.slice(0, USUARIO_MAX);
  const resumen: ResumenImportacion = {
    total: filas.length,
    insertados: 0,
    actualizados: 0,
    sinCelular: 0,
    celularRepetido: [],
  };

  const conexion = await poolConversaciones().getConnection();
  try {
    await conexion.beginTransaction();
    const [existentes] = await conexion.query<RowDataPacket[]>(
      `SELECT id, telefono, cliente, id_cliente_apv AS idApv
         FROM clientes_descuento FOR UPDATE`
    );
    const porApv = new Map<number, Dueno>();
    const porTelefono = new Map<string, Dueno>();
    for (const fila of existentes) {
      const dueno: Dueno = { id: Number(fila.id), cliente: String(fila.cliente) };
      if (fila.idApv != null) porApv.set(Number(fila.idApv), dueno);
      if (fila.telefono != null) porTelefono.set(String(fila.telefono), dueno);
    }

    const inserciones: unknown[][] = [];
    for (const fila of filas) {
      const existente = porApv.get(fila.idClienteApv) ?? null;
      // leerListaApv ya descarta IDs repetidos dentro del archivo; si aun así
      // llegara uno, no hay registro real que actualizar.
      if (existente && existente.id < 0) continue;

      let telefono = fila.telefono;
      if (telefono) {
        const dueno = porTelefono.get(telefono);
        if (dueno && dueno.id !== existente?.id) {
          resumen.celularRepetido.push({
            linea: fila.linea,
            idClienteApv: fila.idClienteApv,
            cliente: fila.cliente,
            telefono,
            asignadoA: dueno.cliente,
          });
          telefono = null;
        }
      }
      if (!telefono) resumen.sinCelular++;

      if (existente) {
        // El celular que tenía antes queda libre para otro registro.
        for (const [numeroPrevio, dueno] of porTelefono) {
          if (dueno.id === existente.id && numeroPrevio !== telefono) porTelefono.delete(numeroPrevio);
        }
        await conexion.query(
          `UPDATE clientes_descuento
              SET telefono = ?, cliente = ?, descuento = ?, rfc = ?, telefono2 = ?, email = ?,
                  id_cliente_bdav = ?, actualizado_por = ?, actualizado_en = ?
            WHERE id = ?`,
          [
            telefono,
            fila.cliente,
            fila.descuento,
            fila.rfc,
            fila.telefono2,
            fila.email,
            fila.idClienteBdav,
            quien,
            momento,
            existente.id,
          ]
        );
        if (telefono) porTelefono.set(telefono, existente);
        resumen.actualizados++;
      } else {
        inserciones.push([
          telefono,
          fila.cliente,
          fila.descuento,
          fila.rfc,
          fila.telefono2,
          fila.email,
          fila.idClienteApv,
          fila.idClienteBdav,
          quien,
          momento,
          quien,
          momento,
        ]);
        const nuevo: Dueno = { id: -inserciones.length, cliente: fila.cliente };
        porApv.set(fila.idClienteApv, nuevo);
        if (telefono) porTelefono.set(telefono, nuevo);
        resumen.insertados++;
      }
    }

    for (let inicio = 0; inicio < inserciones.length; inicio += LOTE_IMPORTACION) {
      await conexion.query(
        `INSERT INTO clientes_descuento
           (telefono, cliente, descuento, rfc, telefono2, email,
            id_cliente_apv, id_cliente_bdav,
            creado_por, creado_en, actualizado_por, actualizado_en)
         VALUES ?`,
        [inserciones.slice(inicio, inicio + LOTE_IMPORTACION)]
      );
    }

    await conexion.commit();
    return resumen;
  } catch (error) {
    await conexion.rollback();
    throw error;
  } finally {
    conexion.release();
  }
}
