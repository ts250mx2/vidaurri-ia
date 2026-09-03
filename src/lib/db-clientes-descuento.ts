import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import {
  ahoraMonterrey,
  asegurarEsquema,
  enTransaccion,
  poolConversaciones,
} from "@/lib/db-conversaciones";
import {
  condicionCelular,
  condicionesBusqueda,
  type CapturaClienteDescuento,
  type ClienteDescuento,
  type FiltroCelular,
} from "./clientes-descuento";
import type { FilaImportacion } from "./importar-clientes-descuento";

// Padrón de clientes con descuento del Vendedor IA. Vive en
// BDVidaurriConversaciones, la única base donde esta aplicación escribe; la
// tabla se auto-crea y se migra desde db-conversaciones.ts. El catálogo de
// clientes de bdav NO se toca: solo se consulta para prellenar y ligar por RFC.
//
// Un cliente puede tener varios celulares: viven en
// clientes_descuento_telefonos, que es la llave única del padrón (un celular
// pertenece a UN cliente). clientes_descuento.telefono es el principal, copia
// del primero de la lista, y se mantiene en cada escritura.

/** Un celular ya pertenece a otro cliente (UNIQUE ux_telefono). */
export class TelefonoDuplicadoError extends Error {
  readonly existente: ClienteDescuento | null;
  readonly telefono: string;

  constructor(existente: ClienteDescuento | null, telefono: string) {
    super(
      telefono ? `El celular ${telefono} ya está registrado` : "Ese celular ya está registrado"
    );
    this.name = "TelefonoDuplicadoError";
    this.existente = existente;
    this.telefono = telefono;
  }
}

/** El ID de la lista APV ya está en otro registro (UNIQUE ux_id_apv). */
export class ReferenciaApvDuplicadaError extends Error {
  constructor() {
    super("Ese ID de cliente APV ya está en el padrón");
    this.name = "ReferenciaApvDuplicadaError";
  }
}

const COLUMNAS = `c.id, c.telefono, c.cliente, c.descuento, c.rfc, c.telefono2, c.email,
       c.id_cliente_apv AS idClienteApv, c.id_cliente_bdav AS idClienteBdav,
       c.permitir_pedido AS permitirPedido,
       (SELECT GROUP_CONCAT(t.telefono ORDER BY t.id SEPARATOR ',')
          FROM clientes_descuento_telefonos t WHERE t.id_cliente = c.id) AS telefonos,
       c.creado_por AS creadoPor, c.creado_en AS creadoEn,
       c.actualizado_por AS actualizadoPor, c.actualizado_en AS actualizadoEn`;

const USUARIO_MAX = 50;
/** Filas por INSERT en la importación: pocas idas a una base remota. */
const LOTE_IMPORTACION = 300;

const texto = (valor: unknown): string | null => (valor == null ? null : String(valor));
const numero = (valor: unknown): number | null => (valor == null ? null : Number(valor));

function aRegistro(fila: RowDataPacket): ClienteDescuento {
  const telefonos = fila.telefonos ? String(fila.telefonos).split(",") : [];
  const principal = texto(fila.telefono);
  return {
    id: Number(fila.id),
    // El principal es el primero de la lista; si la copia quedó desfasada
    // (código anterior), manda la lista.
    telefono: principal && telefonos.includes(principal) ? principal : (telefonos[0] ?? null),
    telefonos,
    cliente: String(fila.cliente),
    descuento: Number(fila.descuento),
    rfc: texto(fila.rfc),
    telefono2: texto(fila.telefono2),
    email: texto(fila.email),
    idClienteApv: numero(fila.idClienteApv),
    idClienteBdav: numero(fila.idClienteBdav),
    permitirPedido: Number(fila.permitirPedido) === 1,
    creadoPor: texto(fila.creadoPor),
    creadoEn: String(fila.creadoEn),
    actualizadoPor: texto(fila.actualizadoPor),
    actualizadoEn: String(fila.actualizadoEn),
  };
}

type Duplicado = { llave: "ux_telefono"; valor: string } | { llave: "ux_id_apv" } | null;

/** Qué llave única chocó (y con qué valor), o null si no es un duplicado. */
function llaveDuplicada(error: unknown): Duplicado {
  if (typeof error !== "object" || error === null) return null;
  const { code, sqlMessage = "" } = error as { code?: string; sqlMessage?: string };
  if (code !== "ER_DUP_ENTRY") return null;
  if (sqlMessage.includes("ux_id_apv")) return { llave: "ux_id_apv" };
  const valor = /Duplicate entry '([^']*)'/.exec(sqlMessage)?.[1] ?? "";
  return { llave: "ux_telefono", valor };
}

/** Traduce el ER_DUP_ENTRY de MySQL al error de dominio que corresponda. */
async function relanzarDuplicado(error: unknown): Promise<never> {
  const duplicado = llaveDuplicada(error);
  if (duplicado?.llave === "ux_id_apv") throw new ReferenciaApvDuplicadaError();
  if (duplicado?.llave === "ux_telefono") {
    const existente = duplicado.valor
      ? await obtenerClienteDescuentoPorTelefono(duplicado.valor)
      : null;
    throw new TelefonoDuplicadoError(existente, duplicado.valor);
  }
  throw error;
}

/**
 * Deja los celulares del cliente exactamente como `telefonos`: quita los que
 * sobran, agrega los que faltan (un choque con otro cliente sale como
 * ER_DUP_ENTRY y lo traduce quien llama).
 */
async function sincronizarTelefonos(
  conexion: PoolConnection,
  idCliente: number,
  telefonos: string[],
  momento: string
): Promise<void> {
  const [filas] = await conexion.query<RowDataPacket[]>(
    "SELECT telefono FROM clientes_descuento_telefonos WHERE id_cliente = ?",
    [idCliente]
  );
  const previos = filas.map((f) => String(f.telefono));
  const sobran = previos.filter((t) => !telefonos.includes(t));
  const faltan = telefonos.filter((t) => !previos.includes(t));
  if (sobran.length > 0) {
    await conexion.query(
      "DELETE FROM clientes_descuento_telefonos WHERE id_cliente = ? AND telefono IN (?)",
      [idCliente, sobran]
    );
  }
  if (faltan.length > 0) {
    await conexion.query(
      "INSERT INTO clientes_descuento_telefonos (id_cliente, telefono, creado_en) VALUES ?",
      [faltan.map((t) => [idCliente, t, momento])]
    );
  }
}

export interface FiltrosClientesDescuento {
  /** Parte del nombre, teléfono, RFC o email. */
  busqueda?: string;
  celular?: FiltroCelular;
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
  const busqueda = condicionesBusqueda(filtros.busqueda ?? "");
  const clausula = `${busqueda.clausula} AND ${condicionCelular(filtros.celular)}`;
  const mesActual = ahoraMonterrey().fecha.slice(0, 7);

  const [filas] = await pool.query<RowDataPacket[]>(
    `SELECT ${COLUMNAS}
       FROM clientes_descuento c
      WHERE ${clausula}
      ORDER BY c.creado_en DESC, c.id DESC
      LIMIT ? OFFSET ?`,
    [...busqueda.parametros, filtros.porPagina, (filtros.pagina - 1) * filtros.porPagina]
  );
  const [totales] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total,
            IFNULL(AVG(c.descuento), 0) AS descuentoPromedio,
            IFNULL(SUM(DATE_FORMAT(c.creado_en, '%Y-%m') = ?), 0) AS altasMes
       FROM clientes_descuento c
      WHERE ${clausula}`,
    [mesActual, ...busqueda.parametros]
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
    `SELECT ${COLUMNAS} FROM clientes_descuento c WHERE c.id = ?`,
    [id]
  );
  return filas.length > 0 ? aRegistro(filas[0]) : null;
}

/** Por celular YA normalizado: es la llave con la que WhatsApp reconoce al cliente. */
export async function obtenerClienteDescuentoPorTelefono(
  telefono: string
): Promise<ClienteDescuento | null> {
  await asegurarEsquema();
  const [filas] = await poolConversaciones().query<RowDataPacket[]>(
    `SELECT ${COLUMNAS}
       FROM clientes_descuento c
       JOIN clientes_descuento_telefonos ct ON ct.id_cliente = c.id
      WHERE ct.telefono = ?`,
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
    const id = await enTransaccion(async (conexion) => {
      const [resultado] = await conexion.query<ResultSetHeader>(
        `INSERT INTO clientes_descuento
           (telefono, cliente, descuento, rfc, telefono2, email,
            id_cliente_apv, id_cliente_bdav, permitir_pedido,
            creado_por, creado_en, actualizado_por, actualizado_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          datos.telefonos[0] ?? null,
          datos.cliente,
          datos.descuento,
          datos.rfc,
          datos.telefono2,
          datos.email,
          datos.idClienteApv,
          datos.idClienteBdav,
          datos.permitirPedido ? 1 : 0,
          quien,
          momento,
          quien,
          momento,
        ]
      );
      await sincronizarTelefonos(conexion, resultado.insertId, datos.telefonos, momento);
      return resultado.insertId;
    });
    const creado = await obtenerClienteDescuento(id);
    if (!creado) throw new Error("El registro no se pudo leer después de crearlo");
    return creado;
  } catch (error) {
    return relanzarDuplicado(error);
  }
}

/** Edición. null si el id no existe; error de duplicado si un celular o el ID APV chocan. */
export async function actualizarClienteDescuento(
  id: number,
  datos: CapturaClienteDescuento,
  usuario: string
): Promise<ClienteDescuento | null> {
  await asegurarEsquema();
  const { momento } = ahoraMonterrey();
  try {
    const existe = await enTransaccion(async (conexion) => {
      const [resultado] = await conexion.query<ResultSetHeader>(
        `UPDATE clientes_descuento
            SET telefono = ?, cliente = ?, descuento = ?, rfc = ?, telefono2 = ?, email = ?,
                id_cliente_apv = ?, id_cliente_bdav = ?, permitir_pedido = ?,
                actualizado_por = ?, actualizado_en = ?
          WHERE id = ?`,
        [
          datos.telefonos[0] ?? null,
          datos.cliente,
          datos.descuento,
          datos.rfc,
          datos.telefono2,
          datos.email,
          datos.idClienteApv,
          datos.idClienteBdav,
          datos.permitirPedido ? 1 : 0,
          usuario.slice(0, USUARIO_MAX),
          momento,
          id,
        ]
      );
      if (resultado.affectedRows === 0) return false;
      await sincronizarTelefonos(conexion, id, datos.telefonos, momento);
      return true;
    });
    return existe ? obtenerClienteDescuento(id) : null;
  } catch (error) {
    return relanzarDuplicado(error);
  }
}

/** Marca o quita "permitir pedido". null si el id no existe. */
export async function cambiarPermitirPedido(
  id: number,
  permitir: boolean,
  usuario: string
): Promise<ClienteDescuento | null> {
  await asegurarEsquema();
  const { momento } = ahoraMonterrey();
  const [resultado] = await poolConversaciones().query<ResultSetHeader>(
    `UPDATE clientes_descuento
        SET permitir_pedido = ?, actualizado_por = ?, actualizado_en = ?
      WHERE id = ?`,
    [permitir ? 1 : 0, usuario.slice(0, USUARIO_MAX), momento, id]
  );
  if (resultado.affectedRows === 0) return null;
  return obtenerClienteDescuento(id);
}

/** Baja. false si el id no existía. Los celulares se van en cascada. */
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
 * está en el padrón se actualizan sus datos (y se le agrega el celular de la
 * lista si no lo tenía, sin quitarle los capturados a mano), si no se inserta.
 * El celular es llave única, y en la lista real 46 números están repetidos
 * entre clientes distintos (mismo dueño con dos razones sociales,
 * familiares…): el primero que aparece se lo queda y los demás entran SIN
 * celular, reportados, para que una persona decida a quién pertenece. Nada se
 * descarta en silencio.
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

  await enTransaccion(async (conexion) => {
    const [existentes] = await conexion.query<RowDataPacket[]>(
      `SELECT id, cliente, id_cliente_apv AS idApv FROM clientes_descuento FOR UPDATE`
    );
    const [celulares] = await conexion.query<RowDataPacket[]>(
      `SELECT id_cliente AS idCliente, telefono FROM clientes_descuento_telefonos FOR UPDATE`
    );
    const porId = new Map<number, Dueno>();
    const porApv = new Map<number, Dueno>();
    for (const fila of existentes) {
      const dueno: Dueno = { id: Number(fila.id), cliente: String(fila.cliente) };
      porId.set(dueno.id, dueno);
      if (fila.idApv != null) porApv.set(Number(fila.idApv), dueno);
    }
    const porTelefono = new Map<string, Dueno>();
    const tieneCelular = new Set<number>();
    for (const fila of celulares) {
      const dueno = porId.get(Number(fila.idCliente));
      if (!dueno) continue;
      porTelefono.set(String(fila.telefono), dueno);
      tieneCelular.add(dueno.id);
    }

    const inserciones: unknown[][] = [];
    /** Celulares por agregar a registros que ya existían: [idCliente, telefono]. */
    const celularesNuevos: Array<[number, string]> = [];
    /** Celular de cada fila nueva, por ID APV, para ligarlo cuando tenga id. */
    const celularPorApv = new Map<number, string>();

    for (const fila of filas) {
      const existente = porApv.get(fila.idClienteApv) ?? null;
      // leerListaApv ya descarta IDs repetidos dentro del archivo; si aun así
      // llegara uno, no hay registro real que actualizar.
      if (existente && existente.id < 0) continue;

      let telefono: string | null = fila.telefonos[0] ?? null;
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

      if (existente) {
        const conservaCelular = tieneCelular.has(existente.id);
        if (telefono && !porTelefono.has(telefono)) {
          celularesNuevos.push([existente.id, telefono]);
          porTelefono.set(telefono, existente);
          tieneCelular.add(existente.id);
        }
        if (!conservaCelular && !telefono) resumen.sinCelular++;
        await conexion.query(
          `UPDATE clientes_descuento
              SET telefono = IFNULL(telefono, ?), cliente = ?, descuento = ?, rfc = ?,
                  telefono2 = ?, email = ?, id_cliente_bdav = ?,
                  actualizado_por = ?, actualizado_en = ?
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
        resumen.actualizados++;
      } else {
        if (!telefono) resumen.sinCelular++;
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
        if (telefono) {
          porTelefono.set(telefono, nuevo);
          celularPorApv.set(fila.idClienteApv, telefono);
        }
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

    // Los celulares de las filas nuevas se ligan por ID APV, sin suponer que
    // los ids autoincrementales salieron consecutivos.
    if (celularPorApv.size > 0) {
      const [ids] = await conexion.query<RowDataPacket[]>(
        `SELECT id, id_cliente_apv AS idApv FROM clientes_descuento WHERE id_cliente_apv IN (?)`,
        [[...celularPorApv.keys()]]
      );
      for (const fila of ids) {
        const telefono = celularPorApv.get(Number(fila.idApv));
        if (telefono) celularesNuevos.push([Number(fila.id), telefono]);
      }
    }
    for (let inicio = 0; inicio < celularesNuevos.length; inicio += LOTE_IMPORTACION) {
      await conexion.query(
        `INSERT INTO clientes_descuento_telefonos (id_cliente, telefono, creado_en) VALUES ?`,
        [celularesNuevos.slice(inicio, inicio + LOTE_IMPORTACION).map(([id, t]) => [id, t, momento])]
      );
    }
  });

  return resumen;
}
