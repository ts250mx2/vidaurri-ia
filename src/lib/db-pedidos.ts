import type { Connection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import {
  ahoraMonterrey,
  asegurarEsquema,
  enTransaccion,
  poolConversaciones,
} from "@/lib/db-conversaciones";
import { moneda } from "@/lib/formato";
import {
  CANTIDAD_MAX,
  ESTATUS_PEDIDO,
  MOTIVO_MAX,
  OBSERVACIONES_MAX,
  PARTIDAS_MAX,
  USUARIO_MAX,
  calcularTotales,
  errorCantidadUsada,
  errorConfirmacionPartida,
  folioDeId,
  puedeCambiarEstatus,
  puedeCancelarCliente,
  redondear2,
  type CanalPedido,
  type ConfirmacionPartida,
  type EstatusPartida,
  type EstatusPedido,
  type EventoPedido,
  type FiltrosPedidos,
  type OrigenPartida,
  type PaginaPedidos,
  type PartidaPedido,
  type PedidoDetalle,
  type PedidoResumen,
  type PerfilPos,
  type SucursalEntrega,
} from "@/lib/pedidos";

// Capa de datos de los pedidos de mostrador. Viven en BDVidaurriConversaciones
// (la única base donde esta aplicación escribe); bdav y la Bodega Usado solo
// se leen, y ni siquiera desde aquí: el precio y la existencia ya vienen
// resueltos por articulos-pedido.ts en la partida que se recibe.
//
// Ciclo de vida: un actor (vendedor del POS o cliente por WhatsApp) tiene a lo
// más UN borrador vivo, identificado por clave_borrador. Al enviarlo recibe
// folio y la clave se limpia; de ahí en adelante el mostrador lo mueve por
// enviado → confirmado → listo → entregado (o cancelado) según su perfil.
// Cada cambio deja rastro en pedidos_mostrador_eventos y los totales de la
// cabecera se recalculan en la misma transacción que la partida que los movió,
// así nunca se lee una cabecera desfasada de sus renglones.

export type ActorCaptura =
  | { tipo: "vendedor"; usuario: string }
  | { tipo: "cliente"; telefono: string };

export class PedidoNoEncontradoError extends Error {
  constructor(mensaje = "El pedido no existe") {
    super(mensaje);
    this.name = "PedidoNoEncontradoError";
  }
}

export class PartidaNoEncontradaError extends Error {
  constructor() {
    super("La partida no existe en este pedido");
    this.name = "PartidaNoEncontradaError";
  }
}

/** El cambio de estatus no está permitido (por la matriz o por el perfil). */
export class TransicionInvalidaError extends Error {
  readonly de: EstatusPedido;
  readonly a: EstatusPedido;

  constructor(de: EstatusPedido, a: EstatusPedido) {
    super(`Un pedido en estatus "${de}" no puede pasar a "${a}"`);
    this.name = "TransicionInvalidaError";
    this.de = de;
    this.a = a;
  }
}

export class PedidoVacioError extends Error {
  constructor() {
    super("El pedido no tiene partidas");
    this.name = "PedidoVacioError";
  }
}

/** Se intentó editar (partidas, sucursal) un pedido que ya no está en captura. */
export class PedidoNoEditableError extends Error {
  readonly estatus: EstatusPedido;

  constructor(estatus: EstatusPedido) {
    super(`El pedido ya está en estatus "${estatus}" y no se puede modificar`);
    this.name = "PedidoNoEditableError";
    this.estatus = estatus;
  }
}

/** El renglón no cabe en el pedido: se rebasó un tope (partidas, cantidad por
 *  renglón, existencia de una pieza usada) o la combinación no existe (una
 *  usada sobre pedido). */
export class LimitePedidoError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "LimitePedidoError";
  }
}

export interface DatosBorrador {
  canal: CanalPedido;
  idCliente: number | null;
  cliente: string;
  telefono: string | null;
  descuentoPct: number;
  sucursal: SucursalEntrega;
}

export interface PartidaNueva {
  origen: OrigenPartida;
  codigo: string | null;
  idPiezaUsada: number | null;
  descripcion: string;
  cantidad: number;
  precioUnitario: number;
  existenciaAlPedir: number | null;
}

export interface ContextoCambioEstatus {
  usuario: string;
  perfil: PerfilPos;
  canal: CanalPedido;
  motivo: string | null;
  folioVentaPos: string | null;
}

/** Pool o conexión de una transacción: ambos consultan igual. */
type Ejecutor = Connection;

const CLIENTE_MAX = 150;
const TELEFONO_MAX = 20;
const DESCRIPCION_MAX = 200;
const DETALLE_MAX = 500;
const ULTIMOS_PEDIDOS_DEFAULT = 5;
const ULTIMOS_PEDIDOS_MAX = 50;
/** Usuario con el que se firman los eventos que dispara el propio cliente. */
const USUARIO_CLIENTE = "cliente";

const COLUMNAS_PEDIDO = `p.id, p.folio, p.estatus, p.canal, p.id_cliente AS idCliente, p.cliente,
       p.telefono, p.descuento_pct AS descuentoPct, p.sucursal,
       p.capturado_por AS capturadoPor, p.atendido_por AS atendidoPor,
       p.subtotal, p.iva, p.total, p.observaciones,
       p.folio_venta_pos AS folioVentaPos, p.motivo_cancelacion AS motivoCancelacion,
       p.creado_en AS creadoEn, p.enviado_en AS enviadoEn, p.confirmado_en AS confirmadoEn,
       p.listo_en AS listoEn, p.entregado_en AS entregadoEn, p.cancelado_en AS canceladoEn,
       p.actualizado_en AS actualizadoEn,
       (SELECT COUNT(*) FROM pedidos_mostrador_partidas pp WHERE pp.id_pedido = p.id) AS numPartidas`;

const COLUMNAS_PARTIDA = `id, partida, origen, codigo, id_pieza_usada AS idPiezaUsada, descripcion,
       cantidad, precio_unitario AS precioUnitario, importe,
       existencia_al_pedir AS existenciaAlPedir, estatus_partida AS estatusPartida,
       dias_entrega AS diasEntrega, nota`;

const COLUMNAS_EVENTO = `id, evento, estatus_anterior AS estatusAnterior, estatus_nuevo AS estatusNuevo,
       detalle, usuario, canal, creado_en AS creadoEn`;

/** Columna de sello por estatus destino: la elige el código, nunca el usuario. */
const SELLO_POR_ESTATUS: Readonly<Partial<Record<EstatusPedido, string>>> = {
  enviado: "enviado_en",
  confirmado: "confirmado_en",
  listo: "listo_en",
  entregado: "entregado_en",
  cancelado: "cancelado_en",
};

const texto = (valor: unknown): string | null => (valor == null ? null : String(valor));
const numero = (valor: unknown): number | null => (valor == null ? null : Number(valor));

/** Los comodines de LIKE que teclee el usuario se buscan literales. */
function escaparLike(valor: string): string {
  return valor.replace(/[\\%_]/g, "\\$&");
}

export function claveBorradorDe(actor: ActorCaptura): string {
  return actor.tipo === "vendedor" ? `v:${actor.usuario}` : `c:${actor.telefono}`;
}

function aResumen(fila: RowDataPacket): PedidoResumen {
  return {
    id: Number(fila.id),
    folio: texto(fila.folio),
    estatus: String(fila.estatus) as EstatusPedido,
    canal: String(fila.canal) as CanalPedido,
    idCliente: numero(fila.idCliente),
    cliente: String(fila.cliente),
    telefono: texto(fila.telefono),
    descuentoPct: Number(fila.descuentoPct),
    sucursal: String(fila.sucursal) as SucursalEntrega,
    capturadoPor: texto(fila.capturadoPor),
    atendidoPor: texto(fila.atendidoPor),
    subtotal: Number(fila.subtotal),
    iva: Number(fila.iva),
    total: Number(fila.total),
    numPartidas: Number(fila.numPartidas),
    creadoEn: String(fila.creadoEn),
    enviadoEn: texto(fila.enviadoEn),
    confirmadoEn: texto(fila.confirmadoEn),
    listoEn: texto(fila.listoEn),
    entregadoEn: texto(fila.entregadoEn),
    canceladoEn: texto(fila.canceladoEn),
    actualizadoEn: String(fila.actualizadoEn),
  };
}

function aPartida(fila: RowDataPacket): PartidaPedido {
  return {
    id: Number(fila.id),
    partida: Number(fila.partida),
    origen: String(fila.origen) as OrigenPartida,
    codigo: texto(fila.codigo),
    idPiezaUsada: numero(fila.idPiezaUsada),
    descripcion: String(fila.descripcion),
    cantidad: Number(fila.cantidad),
    precioUnitario: Number(fila.precioUnitario),
    importe: Number(fila.importe),
    existenciaAlPedir: numero(fila.existenciaAlPedir),
    estatusPartida: String(fila.estatusPartida) as EstatusPartida,
    diasEntrega: numero(fila.diasEntrega),
    nota: texto(fila.nota),
  };
}

function aEvento(fila: RowDataPacket): EventoPedido {
  return {
    id: Number(fila.id),
    evento: String(fila.evento),
    estatusAnterior: texto(fila.estatusAnterior) as EstatusPedido | null,
    estatusNuevo: texto(fila.estatusNuevo) as EstatusPedido | null,
    detalle: texto(fila.detalle),
    usuario: texto(fila.usuario),
    canal: String(fila.canal) as CanalPedido,
    creadoEn: String(fila.creadoEn),
  };
}

function aDetalle(fila: RowDataPacket, partidas: RowDataPacket[], eventos: RowDataPacket[]): PedidoDetalle {
  return {
    ...aResumen(fila),
    observaciones: texto(fila.observaciones),
    folioVentaPos: texto(fila.folioVentaPos),
    motivoCancelacion: texto(fila.motivoCancelacion),
    partidas: partidas.map(aPartida),
    eventos: eventos.map(aEvento),
  };
}

/** Cabecera + partidas + eventos. Con la conexión de una transacción devuelve
 *  lo que esa transacción ya escribió, aunque no haya hecho commit. */
async function leerDetalle(ejecutor: Ejecutor, id: number): Promise<PedidoDetalle | null> {
  const [cabeceras] = await ejecutor.query<RowDataPacket[]>(
    `SELECT ${COLUMNAS_PEDIDO} FROM pedidos_mostrador p WHERE p.id = ?`,
    [id]
  );
  if (cabeceras.length === 0) return null;
  const [partidas] = await ejecutor.query<RowDataPacket[]>(
    `SELECT ${COLUMNAS_PARTIDA} FROM pedidos_mostrador_partidas WHERE id_pedido = ? ORDER BY partida, id`,
    [id]
  );
  const [eventos] = await ejecutor.query<RowDataPacket[]>(
    `SELECT ${COLUMNAS_EVENTO} FROM pedidos_mostrador_eventos WHERE id_pedido = ? ORDER BY id`,
    [id]
  );
  return aDetalle(cabeceras[0], partidas, eventos);
}

/** El detalle recién escrito; que no exista después de tocarlo es un error de programación. */
async function detalleEscrito(conexion: Connection, id: number): Promise<PedidoDetalle> {
  const detalle = await leerDetalle(conexion, id);
  if (!detalle) throw new Error(`El pedido ${id} no se pudo leer después de escribirlo`);
  return detalle;
}

interface CabeceraBloqueada {
  id: number;
  estatus: EstatusPedido;
  canal: CanalPedido;
  idCliente: number | null;
  cliente: string;
  telefono: string | null;
  descuentoPct: number;
  sucursal: SucursalEntrega;
}

/**
 * Cabecera con bloqueo de fila (FOR UPDATE): todo lo que cambia un pedido lo
 * lee así primero, para que dos peticiones simultáneas (Vico y la pantalla,
 * por ejemplo) se serialicen en vez de pisarse.
 */
async function bloquearPedido(conexion: Connection, id: number): Promise<CabeceraBloqueada> {
  const [filas] = await conexion.query<RowDataPacket[]>(
    `SELECT id, estatus, canal, id_cliente AS idCliente, cliente, telefono,
            descuento_pct AS descuentoPct, sucursal
       FROM pedidos_mostrador WHERE id = ? FOR UPDATE`,
    [id]
  );
  if (filas.length === 0) throw new PedidoNoEncontradoError();
  const fila = filas[0];
  return {
    id: Number(fila.id),
    estatus: String(fila.estatus) as EstatusPedido,
    canal: String(fila.canal) as CanalPedido,
    idCliente: numero(fila.idCliente),
    cliente: String(fila.cliente),
    telefono: texto(fila.telefono),
    descuentoPct: Number(fila.descuentoPct),
    sucursal: String(fila.sucursal) as SucursalEntrega,
  };
}

interface DatosEvento {
  evento: string;
  estatusAnterior?: EstatusPedido | null;
  estatusNuevo?: EstatusPedido | null;
  detalle?: string | null;
  usuario: string | null;
  canal: CanalPedido;
}

async function registrarEvento(
  conexion: Connection,
  idPedido: number,
  datos: DatosEvento,
  momento: string
): Promise<void> {
  await conexion.query(
    `INSERT INTO pedidos_mostrador_eventos
       (id_pedido, evento, estatus_anterior, estatus_nuevo, detalle, usuario, canal, creado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      idPedido,
      datos.evento,
      datos.estatusAnterior ?? null,
      datos.estatusNuevo ?? null,
      datos.detalle?.slice(0, DETALLE_MAX) ?? null,
      datos.usuario?.slice(0, USUARIO_MAX) ?? null,
      datos.canal,
      momento,
    ]
  );
}

/** Vuelve a sumar las partidas y deja la cabecera cuadrada con ellas. */
async function recalcularTotales(conexion: Connection, idPedido: number, momento: string): Promise<void> {
  const [filas] = await conexion.query<RowDataPacket[]>(
    `SELECT cantidad, precio_unitario AS precioUnitario
       FROM pedidos_mostrador_partidas WHERE id_pedido = ?`,
    [idPedido]
  );
  const totales = calcularTotales(
    filas.map((f) => ({ cantidad: Number(f.cantidad), precioUnitario: Number(f.precioUnitario) }))
  );
  await conexion.query(
    `UPDATE pedidos_mostrador SET subtotal = ?, iva = ?, total = ?, actualizado_en = ? WHERE id = ?`,
    [totales.subtotal, totales.iva, totales.total, momento, idPedido]
  );
}

/** Cancela un borrador que estorba (el actor empezó otro). Sin folio: nunca
 *  salió de captura, pero queda en la bitácora por si hay que rastrearlo
 *  (fuera de la cola: listarPedidos solo enseña lo que tiene folio). */
async function cancelarBorradorPrevio(
  conexion: Connection,
  previo: CabeceraBloqueada,
  usuario: string | null,
  canal: CanalPedido,
  motivo: string,
  momento: string
): Promise<void> {
  await conexion.query(
    `UPDATE pedidos_mostrador
        SET estatus = 'cancelado', clave_borrador = NULL, motivo_cancelacion = ?,
            atendido_por = ?, cancelado_en = ?, actualizado_en = ?
      WHERE id = ?`,
    [motivo.slice(0, MOTIVO_MAX), usuario?.slice(0, USUARIO_MAX) ?? null, momento, momento, previo.id]
  );
  await registrarEvento(
    conexion,
    previo.id,
    { evento: "cancelado", estatusAnterior: previo.estatus, estatusNuevo: "cancelado", detalle: motivo, usuario, canal },
    momento
  );
}

/** Borrador vivo del actor, con bloqueo, o null. */
async function bloquearBorradorDe(conexion: Connection, actor: ActorCaptura): Promise<CabeceraBloqueada | null> {
  const [filas] = await conexion.query<RowDataPacket[]>(
    `SELECT id FROM pedidos_mostrador
      WHERE clave_borrador = ? AND estatus = 'borrador'
      ORDER BY id DESC LIMIT 1 FOR UPDATE`,
    [claveBorradorDe(actor)]
  );
  return filas.length > 0 ? bloquearPedido(conexion, Number(filas[0].id)) : null;
}

/** Mismo cliente del padrón o, para público general, mismo nombre capturado. */
function mismoCliente(previo: CabeceraBloqueada, datos: DatosBorrador): boolean {
  if (datos.idCliente !== null) return previo.idCliente === datos.idCliente;
  return previo.idCliente === null && previo.cliente.trim().toLowerCase() === datos.cliente.trim().toLowerCase();
}

function usuarioDe(actor: ActorCaptura): string {
  return actor.tipo === "vendedor" ? actor.usuario : USUARIO_CLIENTE;
}

/** Texto para la bitácora de un renglón: '2 × FAC123 · Facia Versa ($1,234.00)'. */
function describirPartida(partida: {
  cantidad: number;
  codigo: string | null;
  idPiezaUsada: number | null;
  descripcion: string;
  precioUnitario: number;
}): string {
  const referencia = partida.codigo ?? (partida.idPiezaUsada !== null ? `usada #${partida.idPiezaUsada}` : "");
  return `${partida.cantidad} × ${referencia} · ${partida.descripcion} (${moneda(partida.precioUnitario)})`;
}

// ---------------------------------------------------------------------------
// Borrador (captura).
// ---------------------------------------------------------------------------

export async function obtenerBorrador(actor: ActorCaptura): Promise<PedidoDetalle | null> {
  await asegurarEsquema();
  const [filas] = await poolConversaciones().query<RowDataPacket[]>(
    `SELECT id FROM pedidos_mostrador
      WHERE clave_borrador = ? AND estatus = 'borrador'
      ORDER BY id DESC LIMIT 1`,
    [claveBorradorDe(actor)]
  );
  if (filas.length === 0) return null;
  return leerDetalle(poolConversaciones(), Number(filas[0].id));
}

/**
 * Al reutilizar un borrador se le pone al día lo que describe al cliente
 * (nombre, celular y, sobre todo, el descuento del padrón, que pudo cambiar
 * con la captura abierta) y la sucursal. El descuento y la sucursal dejan
 * evento, como cualquier otro cambio; el nombre y el celular no, porque son
 * el mismo cliente mejor escrito. Las partidas que ya estaban conservan el
 * precio con el que se cotizaron.
 */
async function refrescarBorrador(
  conexion: Connection,
  previo: CabeceraBloqueada,
  datos: DatosBorrador,
  usuario: string,
  momento: string
): Promise<void> {
  const cliente = datos.cliente.slice(0, CLIENTE_MAX);
  const telefono = datos.telefono?.slice(0, TELEFONO_MAX) ?? null;
  const cambiaDescuento = previo.descuentoPct !== datos.descuentoPct;
  const cambiaSucursal = previo.sucursal !== datos.sucursal;
  const sinCambios =
    !cambiaDescuento && !cambiaSucursal && previo.cliente === cliente && previo.telefono === telefono;
  if (sinCambios) return;

  await conexion.query(
    `UPDATE pedidos_mostrador
        SET cliente = ?, telefono = ?, descuento_pct = ?, sucursal = ?, actualizado_en = ?
      WHERE id = ?`,
    [cliente, telefono, datos.descuentoPct, datos.sucursal, momento, previo.id]
  );
  if (cambiaDescuento) {
    await registrarEvento(
      conexion,
      previo.id,
      {
        evento: "descuento_actualizado",
        detalle: `${previo.descuentoPct}% → ${datos.descuentoPct}% (las partidas ya capturadas conservan su precio)`,
        usuario,
        canal: datos.canal,
      },
      momento
    );
  }
  if (cambiaSucursal) {
    await registrarEvento(
      conexion,
      previo.id,
      { evento: "sucursal_cambiada", detalle: `${previo.sucursal} → ${datos.sucursal}`, usuario, canal: datos.canal },
      momento
    );
  }
}

/**
 * Abre el borrador del actor. Si ya tenía uno para el MISMO cliente se
 * reutiliza (con sus partidas), porque lo más probable es que siga la misma
 * captura, y se le refrescan cliente, celular, descuento y sucursal
 * (refrescarBorrador); si era para otro cliente se cancela, porque los
 * precios de las partidas llevan el descuento de aquel cliente y no sirven
 * para este. Quien quiera avisar antes de tirar partidas (la API devuelve
 * 409) consulta obtenerBorrador primero.
 */
export async function crearBorrador(actor: ActorCaptura, datos: DatosBorrador): Promise<PedidoDetalle> {
  await asegurarEsquema();
  const { momento } = ahoraMonterrey();
  const usuario = usuarioDe(actor);

  const id = await enTransaccion(async (conexion) => {
    const previo = await bloquearBorradorDe(conexion, actor);
    if (previo && mismoCliente(previo, datos)) {
      await refrescarBorrador(conexion, previo, datos, usuario, momento);
      return previo.id;
    }
    if (previo) {
      await cancelarBorradorPrevio(
        conexion,
        previo,
        usuario,
        datos.canal,
        `Reemplazado por un borrador nuevo para ${datos.cliente}`,
        momento
      );
    }

    const [resultado] = await conexion.query<ResultSetHeader>(
      `INSERT INTO pedidos_mostrador
         (estatus, canal, clave_borrador, id_cliente, cliente, telefono, descuento_pct, sucursal,
          capturado_por, creado_en, actualizado_en)
       VALUES ('borrador', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        datos.canal,
        claveBorradorDe(actor),
        datos.idCliente,
        datos.cliente.slice(0, CLIENTE_MAX),
        datos.telefono?.slice(0, TELEFONO_MAX) ?? null,
        datos.descuentoPct,
        datos.sucursal,
        actor.tipo === "vendedor" ? actor.usuario.slice(0, USUARIO_MAX) : null,
        momento,
        momento,
      ]
    );
    await registrarEvento(
      conexion,
      resultado.insertId,
      {
        evento: "creado",
        estatusNuevo: "borrador",
        detalle: datos.idCliente === null ? "Público general" : `Cliente #${datos.idCliente} · ${datos.cliente}`,
        usuario,
        canal: datos.canal,
      },
      momento
    );
    return resultado.insertId;
  });

  const detalle = await obtenerPedido(id);
  if (!detalle) throw new Error(`El borrador ${id} no se pudo leer después de crearlo`);
  return detalle;
}

/** Renglón que ya está en el pedido con la misma referencia (código o pieza usada). */
async function partidaRepetida(
  conexion: Connection,
  idPedido: number,
  partida: PartidaNueva
): Promise<{ id: number; cantidad: number } | null> {
  const [filas] =
    partida.idPiezaUsada !== null
      ? await conexion.query<RowDataPacket[]>(
          `SELECT id, cantidad FROM pedidos_mostrador_partidas
            WHERE id_pedido = ? AND id_pieza_usada = ? LIMIT 1`,
          [idPedido, partida.idPiezaUsada]
        )
      : await conexion.query<RowDataPacket[]>(
          `SELECT id, cantidad FROM pedidos_mostrador_partidas
            WHERE id_pedido = ? AND id_pieza_usada IS NULL AND UPPER(codigo) = UPPER(?) LIMIT 1`,
          [idPedido, partida.codigo ?? ""]
        );
  return filas.length > 0 ? { id: Number(filas[0].id), cantidad: Number(filas[0].cantidad) } : null;
}

/**
 * Agrega un renglón al borrador. Si la misma pieza ya estaba, se le suma la
 * cantidad (y se le pone el precio y la existencia recién cotizados, que son
 * los que el cliente acaba de oír) en vez de duplicar el renglón. Una pieza
 * usada nunca rebasa su existencia, ni sumando: es una unidad física.
 */
export async function agregarPartida(
  idPedido: number,
  partida: PartidaNueva,
  usuario: string | null,
  canal: CanalPedido
): Promise<PedidoDetalle> {
  await asegurarEsquema();
  const { momento } = ahoraMonterrey();
  const precioUnitario = redondear2(partida.precioUnitario);

  return enTransaccion(async (conexion) => {
    const pedido = await bloquearPedido(conexion, idPedido);
    if (pedido.estatus !== "borrador") throw new PedidoNoEditableError(pedido.estatus);

    const repetida = await partidaRepetida(conexion, idPedido, partida);
    let cantidad = partida.cantidad;
    if (repetida) {
      cantidad = repetida.cantidad + partida.cantidad;
      if (cantidad > CANTIDAD_MAX) {
        throw new LimitePedidoError(`No se pueden pedir más de ${CANTIDAD_MAX} piezas iguales`);
      }
    }
    if (partida.origen === "usada") {
      const sobra = errorCantidadUsada(partida.existenciaAlPedir, cantidad);
      if (sobra) throw new LimitePedidoError(repetida ? `${sobra} (ya llevas ${repetida.cantidad})` : sobra);
    }
    if (repetida) {
      await conexion.query(
        `UPDATE pedidos_mostrador_partidas
            SET cantidad = ?, precio_unitario = ?, importe = ?, existencia_al_pedir = ?,
                descripcion = ?, actualizado_en = ?
          WHERE id = ?`,
        [
          cantidad,
          precioUnitario,
          redondear2(cantidad * precioUnitario),
          partida.existenciaAlPedir,
          partida.descripcion.slice(0, DESCRIPCION_MAX),
          momento,
          repetida.id,
        ]
      );
    } else {
      const [conteo] = await conexion.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS renglones, IFNULL(MAX(partida), 0) AS ultima
           FROM pedidos_mostrador_partidas WHERE id_pedido = ?`,
        [idPedido]
      );
      if (Number(conteo[0]?.renglones ?? 0) >= PARTIDAS_MAX) {
        throw new LimitePedidoError(`Un pedido no puede tener más de ${PARTIDAS_MAX} partidas`);
      }
      await conexion.query(
        `INSERT INTO pedidos_mostrador_partidas
           (id_pedido, partida, origen, codigo, id_pieza_usada, descripcion, cantidad,
            precio_unitario, importe, existencia_al_pedir, estatus_partida, creado_en, actualizado_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendiente', ?, ?)`,
        [
          idPedido,
          Number(conteo[0]?.ultima ?? 0) + 1,
          partida.origen,
          partida.codigo,
          partida.idPiezaUsada,
          partida.descripcion.slice(0, DESCRIPCION_MAX),
          cantidad,
          precioUnitario,
          redondear2(cantidad * precioUnitario),
          partida.existenciaAlPedir,
          momento,
          momento,
        ]
      );
    }

    await registrarEvento(
      conexion,
      idPedido,
      {
        evento: "partida_agregada",
        detalle:
          describirPartida({ ...partida, precioUnitario }) +
          (repetida ? ` → ${cantidad} en total` : ""),
        usuario,
        canal,
      },
      momento
    );
    await recalcularTotales(conexion, idPedido, momento);
    return detalleEscrito(conexion, idPedido);
  });
}

/** Deja los renglones numerados 1..n sin huecos después de quitar uno. */
async function renumerarPartidas(conexion: Connection, idPedido: number, momento: string): Promise<void> {
  const [filas] = await conexion.query<RowDataPacket[]>(
    `SELECT id, partida FROM pedidos_mostrador_partidas WHERE id_pedido = ? ORDER BY partida, id`,
    [idPedido]
  );
  for (const [indice, fila] of filas.entries()) {
    if (Number(fila.partida) === indice + 1) continue;
    await conexion.query(`UPDATE pedidos_mostrador_partidas SET partida = ?, actualizado_en = ? WHERE id = ?`, [
      indice + 1,
      momento,
      Number(fila.id),
    ]);
  }
}

export async function quitarPartida(
  idPedido: number,
  idPartida: number,
  usuario: string | null,
  canal: CanalPedido
): Promise<PedidoDetalle> {
  await asegurarEsquema();
  const { momento } = ahoraMonterrey();

  return enTransaccion(async (conexion) => {
    const pedido = await bloquearPedido(conexion, idPedido);
    if (pedido.estatus !== "borrador") throw new PedidoNoEditableError(pedido.estatus);

    const [filas] = await conexion.query<RowDataPacket[]>(
      `SELECT ${COLUMNAS_PARTIDA} FROM pedidos_mostrador_partidas WHERE id = ? AND id_pedido = ?`,
      [idPartida, idPedido]
    );
    if (filas.length === 0) throw new PartidaNoEncontradaError();
    const quitada = aPartida(filas[0]);

    await conexion.query(`DELETE FROM pedidos_mostrador_partidas WHERE id = ?`, [idPartida]);
    await renumerarPartidas(conexion, idPedido, momento);
    await registrarEvento(
      conexion,
      idPedido,
      { evento: "partida_quitada", detalle: describirPartida(quitada), usuario, canal },
      momento
    );
    await recalcularTotales(conexion, idPedido, momento);
    return detalleEscrito(conexion, idPedido);
  });
}

/** Dónde recoge. Se puede cambiar mientras el mostrador no haya empezado a
 *  surtir (borrador o enviado); después la pieza ya está en camino a una sucursal. */
export async function cambiarSucursal(
  idPedido: number,
  sucursal: SucursalEntrega,
  usuario: string | null,
  canal: CanalPedido
): Promise<PedidoDetalle> {
  await asegurarEsquema();
  const { momento } = ahoraMonterrey();

  return enTransaccion(async (conexion) => {
    const pedido = await bloquearPedido(conexion, idPedido);
    if (pedido.estatus !== "borrador" && pedido.estatus !== "enviado") {
      throw new PedidoNoEditableError(pedido.estatus);
    }
    if (pedido.sucursal === sucursal) return detalleEscrito(conexion, idPedido);

    await conexion.query(`UPDATE pedidos_mostrador SET sucursal = ?, actualizado_en = ? WHERE id = ?`, [
      sucursal,
      momento,
      idPedido,
    ]);
    await registrarEvento(
      conexion,
      idPedido,
      { evento: "sucursal_cambiada", detalle: `${pedido.sucursal} → ${sucursal}`, usuario, canal },
      momento
    );
    return detalleEscrito(conexion, idPedido);
  });
}

/**
 * borrador → enviado: el pedido recibe folio y deja de ser el borrador del
 * actor. Los totales se recalculan por última vez aquí para que el folio
 * nazca con la cabecera cuadrada con sus renglones.
 */
export async function enviarPedido(
  idPedido: number,
  usuario: string | null,
  canal: CanalPedido,
  observaciones: string | null
): Promise<PedidoDetalle> {
  await asegurarEsquema();
  const { momento } = ahoraMonterrey();

  return enTransaccion(async (conexion) => {
    const pedido = await bloquearPedido(conexion, idPedido);
    if (pedido.estatus !== "borrador") throw new TransicionInvalidaError(pedido.estatus, "enviado");

    const [conteo] = await conexion.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS renglones FROM pedidos_mostrador_partidas WHERE id_pedido = ?`,
      [idPedido]
    );
    if (Number(conteo[0]?.renglones ?? 0) === 0) throw new PedidoVacioError();

    await recalcularTotales(conexion, idPedido, momento);
    await conexion.query(
      `UPDATE pedidos_mostrador
          SET estatus = 'enviado', folio = ?, clave_borrador = NULL, observaciones = ?,
              enviado_en = ?, actualizado_en = ?
        WHERE id = ?`,
      [folioDeId(idPedido), observaciones?.slice(0, OBSERVACIONES_MAX) ?? null, momento, momento, idPedido]
    );
    await registrarEvento(
      conexion,
      idPedido,
      {
        evento: "enviado",
        estatusAnterior: "borrador",
        estatusNuevo: "enviado",
        detalle: `Folio ${folioDeId(idPedido)} · recoge en ${pedido.sucursal}`,
        usuario,
        canal,
      },
      momento
    );
    return detalleEscrito(conexion, idPedido);
  });
}

// ---------------------------------------------------------------------------
// Mostrador (seguimiento).
// ---------------------------------------------------------------------------

/**
 * Mueve el pedido por el flujo del mostrador. La matriz de transiciones y el
 * perfil los decide puedeCambiarEstatus; aquí solo se aplica: sello de fecha
 * del estatus destino, quién lo atendió y, si aplica, el motivo de cancelación
 * o el folio de la venta del POS con la que se entregó.
 */
export async function cambiarEstatus(
  idPedido: number,
  a: EstatusPedido,
  ctx: ContextoCambioEstatus
): Promise<PedidoDetalle> {
  await asegurarEsquema();
  const { momento } = ahoraMonterrey();
  const sello = SELLO_POR_ESTATUS[a];

  return enTransaccion(async (conexion) => {
    const pedido = await bloquearPedido(conexion, idPedido);
    if (!puedeCambiarEstatus(ctx.perfil, pedido.estatus, a) || !sello) {
      throw new TransicionInvalidaError(pedido.estatus, a);
    }

    const motivo = a === "cancelado" ? (ctx.motivo?.slice(0, MOTIVO_MAX) ?? null) : null;
    const folioVentaPos = a === "entregado" ? ctx.folioVentaPos : null;
    // `sello` sale de un mapa fijo del código, nunca de la petición.
    await conexion.query(
      `UPDATE pedidos_mostrador
          SET estatus = ?, atendido_por = ?, ${sello} = ?, actualizado_en = ?,
              motivo_cancelacion = IF(?, ?, motivo_cancelacion),
              folio_venta_pos = IF(?, ?, folio_venta_pos)
        WHERE id = ?`,
      [
        a,
        ctx.usuario.slice(0, USUARIO_MAX),
        momento,
        momento,
        a === "cancelado" ? 1 : 0,
        motivo,
        a === "entregado" ? 1 : 0,
        folioVentaPos,
        idPedido,
      ]
    );

    const detalle =
      a === "cancelado" ? motivo : a === "entregado" && folioVentaPos ? `Venta POS ${folioVentaPos}` : null;
    await registrarEvento(
      conexion,
      idPedido,
      { evento: a, estatusAnterior: pedido.estatus, estatusNuevo: a, detalle, usuario: ctx.usuario, canal: ctx.canal },
      momento
    );
    return detalleEscrito(conexion, idPedido);
  });
}

/**
 * El cliente echa atrás su propio pedido (borrador o enviado; después ya hay
 * trabajo del mostrador y tiene que pedirlo por WhatsApp). Un pedido que no es
 * de ese teléfono se reporta como inexistente, para no revelar pedidos ajenos.
 */
export async function cancelarPorCliente(
  idPedido: number,
  telefono: string,
  motivo: string | null
): Promise<PedidoDetalle> {
  await asegurarEsquema();
  const { momento } = ahoraMonterrey();

  return enTransaccion(async (conexion) => {
    const pedido = await bloquearPedido(conexion, idPedido);
    if (!pedido.telefono || pedido.telefono !== telefono) throw new PedidoNoEncontradoError();
    if (!puedeCancelarCliente(pedido.estatus)) throw new TransicionInvalidaError(pedido.estatus, "cancelado");

    const motivoLimpio = motivo?.slice(0, MOTIVO_MAX) ?? null;
    await conexion.query(
      `UPDATE pedidos_mostrador
          SET estatus = 'cancelado', clave_borrador = NULL, motivo_cancelacion = ?,
              atendido_por = ?, cancelado_en = ?, actualizado_en = ?
        WHERE id = ?`,
      [motivoLimpio, USUARIO_CLIENTE, momento, momento, idPedido]
    );
    await registrarEvento(
      conexion,
      idPedido,
      {
        evento: "cancelado",
        estatusAnterior: pedido.estatus,
        estatusNuevo: "cancelado",
        detalle: motivoLimpio ?? "Cancelado por el cliente",
        usuario: USUARIO_CLIENTE,
        canal: pedido.canal,
      },
      momento
    );
    return detalleEscrito(conexion, idPedido);
  });
}

/** Resumen para la bitácora: '2 confirmadas, 1 sin existencia'. */
function resumirConfirmacion(cambios: ConfirmacionPartida[]): string {
  const etiquetas: Record<EstatusPartida, [string, string]> = {
    pendiente: ["pendiente", "pendientes"],
    confirmada: ["confirmada", "confirmadas"],
    sin_existencia: ["sin existencia", "sin existencia"],
    sobre_pedido: ["sobre pedido", "sobre pedido"],
  };
  const conteo = new Map<EstatusPartida, number>();
  for (const cambio of cambios) conteo.set(cambio.estatusPartida, (conteo.get(cambio.estatusPartida) ?? 0) + 1);
  return [...conteo.entries()].map(([estatus, n]) => `${n} ${etiquetas[estatus][n === 1 ? 0 : 1]}`).join(", ");
}

/**
 * El mostrador dice renglón por renglón qué sí hay, qué no y qué se pide al
 * proveedor. No mueve el estatus del pedido (eso lo hace cambiarEstatus a
 * "confirmado" cuando el vendedor termina). Una partida que se marca sobre
 * pedido cambia de origen, y si se vuelve a marcar de otra forma regresa a
 * nueva; las usadas nunca son sobre pedido (se rechaza, no se ignora, para
 * que no quede un renglón usada/sobre_pedido con días de entrega).
 */
export async function confirmarPartidas(
  idPedido: number,
  cambios: ConfirmacionPartida[],
  usuario: string
): Promise<PedidoDetalle> {
  await asegurarEsquema();
  const { momento } = ahoraMonterrey();

  return enTransaccion(async (conexion) => {
    const pedido = await bloquearPedido(conexion, idPedido);
    if (pedido.estatus !== "enviado" && pedido.estatus !== "confirmado") {
      throw new PedidoNoEditableError(pedido.estatus);
    }

    const [renglones] = await conexion.query<RowDataPacket[]>(
      `SELECT id, origen FROM pedidos_mostrador_partidas WHERE id_pedido = ? FOR UPDATE`,
      [idPedido]
    );
    const origenPorId = new Map(renglones.map((r) => [Number(r.id), String(r.origen) as OrigenPartida]));
    for (const cambio of cambios) {
      const origen = origenPorId.get(cambio.id);
      if (origen === undefined) throw new PartidaNoEncontradaError();
      const invalida = errorConfirmacionPartida(origen, cambio.estatusPartida);
      if (invalida) throw new LimitePedidoError(`${invalida} (partida ${cambio.id})`);
    }

    for (const cambio of cambios) {
      const esSobrePedido = cambio.estatusPartida === "sobre_pedido";
      const [resultado] = await conexion.query<ResultSetHeader>(
        `UPDATE pedidos_mostrador_partidas
            SET estatus_partida = ?, dias_entrega = ?, nota = ?,
                origen = CASE
                  WHEN origen = 'usada' THEN origen
                  WHEN ? THEN 'sobre_pedido'
                  ELSE 'nueva' END,
                actualizado_en = ?
          WHERE id = ? AND id_pedido = ?`,
        [
          cambio.estatusPartida,
          esSobrePedido ? cambio.diasEntrega : null,
          cambio.nota,
          esSobrePedido ? 1 : 0,
          momento,
          cambio.id,
          idPedido,
        ]
      );
      if (resultado.affectedRows === 0) throw new PartidaNoEncontradaError();
    }

    await conexion.query(`UPDATE pedidos_mostrador SET atendido_por = ?, actualizado_en = ? WHERE id = ?`, [
      usuario.slice(0, USUARIO_MAX),
      momento,
      idPedido,
    ]);
    await registrarEvento(
      conexion,
      idPedido,
      { evento: "partidas_confirmadas", detalle: resumirConfirmacion(cambios), usuario, canal: "mostrador" },
      momento
    );
    return detalleEscrito(conexion, idPedido);
  });
}

// ---------------------------------------------------------------------------
// Lectura.
// ---------------------------------------------------------------------------

export async function obtenerPedido(id: number): Promise<PedidoDetalle | null> {
  await asegurarEsquema();
  if (!Number.isInteger(id) || id <= 0) return null;
  return leerDetalle(poolConversaciones(), id);
}

export async function obtenerPedidoPorFolio(folio: string): Promise<PedidoDetalle | null> {
  await asegurarEsquema();
  const limpio = folio.trim().toUpperCase();
  if (!limpio) return null;
  const [filas] = await poolConversaciones().query<RowDataPacket[]>(
    `SELECT id FROM pedidos_mostrador WHERE folio = ? LIMIT 1`,
    [limpio]
  );
  if (filas.length === 0) return null;
  return leerDetalle(poolConversaciones(), Number(filas[0].id));
}

interface CondicionesArmadas {
  clausula: string;
  parametros: (string | number)[];
}

/** Condiciones comunes de la cola (sin el estatus, que se aplica aparte para
 *  que el conteo por estatus refleje el resto de los filtros). */
function armarCondiciones(filtros: FiltrosPedidos): CondicionesArmadas {
  const condiciones: string[] = ["1 = 1"];
  const parametros: (string | number)[] = [];

  if (filtros.sucursal) {
    condiciones.push("p.sucursal = ?");
    parametros.push(filtros.sucursal);
  }
  if (filtros.canal) {
    condiciones.push("p.canal = ?");
    parametros.push(filtros.canal);
  }
  if (filtros.usuario) {
    condiciones.push("(p.capturado_por = ? OR p.atendido_por = ?)");
    parametros.push(filtros.usuario, filtros.usuario);
  }
  if (filtros.desde) {
    condiciones.push("p.creado_en >= ?");
    parametros.push(`${filtros.desde} 00:00:00`);
  }
  if (filtros.hasta) {
    condiciones.push("p.creado_en <= ?");
    parametros.push(`${filtros.hasta} 23:59:59`);
  }
  if (filtros.busqueda) {
    // Folio (con o sin 'P-' y ceros), nombre del cliente o teléfono. Un número
    // suelto se prueba también como número de folio: '131' encuentra P-000131.
    const texto = filtros.busqueda.trim();
    const parecido = `%${escaparLike(texto)}%`;
    const digitos = texto.replace(/\D/g, "");
    const partes = ["p.folio LIKE ?", "p.cliente LIKE ?"];
    parametros.push(parecido.toUpperCase(), parecido);
    if (digitos) {
      partes.push("p.telefono LIKE ?", "p.folio = ?");
      parametros.push(`%${digitos}%`, folioDeId(Number(digitos)));
    }
    condiciones.push(`(${partes.join(" OR ")})`);
  }
  return { clausula: condiciones.join(" AND "), parametros };
}

/**
 * Lo que cuenta como pedido en la cola: lo que tiene folio, es decir, lo que
 * alguna vez se envió. Un borrador descartado queda cancelado sin folio y no
 * es un pedido (nunca salió de captura); los borradores vivos solo entran
 * cuando se piden explícitamente (estatus = borrador).
 */
const CONDICION_SALIO_DE_CAPTURA = "p.folio IS NOT NULL";

function condicionEstatusCola(estatus: EstatusPedido | undefined): { sql: string; parametros: string[] } {
  if (estatus === "borrador") return { sql: "p.estatus = 'borrador'", parametros: [] };
  if (estatus) return { sql: `p.estatus = ? AND ${CONDICION_SALIO_DE_CAPTURA}`, parametros: [estatus] };
  return { sql: CONDICION_SALIO_DE_CAPTURA, parametros: [] };
}

/**
 * Cola del mostrador, más recientes primero. Los borradores son captura en
 * curso, no pedidos: quedan fuera salvo que se pidan explícitamente, y los
 * borradores descartados (cancelados sin folio) nunca entran. El conteo por
 * estatus se calcula con los demás filtros para que las pestañas de la
 * pantalla sepan cuánto hay en cada una (los borradores vivos se cuentan
 * como tales, para que cuadren con el filtro explícito).
 */
export async function listarPedidos(filtros: FiltrosPedidos): Promise<PaginaPedidos> {
  await asegurarEsquema();
  const pool = poolConversaciones();
  const { clausula, parametros } = armarCondiciones(filtros);
  const { sql: condicionEstatus, parametros: parametrosEstatus } = condicionEstatusCola(filtros.estatus);

  const [filas] = await pool.query<RowDataPacket[]>(
    `SELECT ${COLUMNAS_PEDIDO}
       FROM pedidos_mostrador p
      WHERE ${clausula} AND ${condicionEstatus}
      ORDER BY p.creado_en DESC, p.id DESC
      LIMIT ? OFFSET ?`,
    [...parametros, ...parametrosEstatus, filtros.porPagina, (filtros.pagina - 1) * filtros.porPagina]
  );
  const [totales] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM pedidos_mostrador p WHERE ${clausula} AND ${condicionEstatus}`,
    [...parametros, ...parametrosEstatus]
  );
  const [conteos] = await pool.query<RowDataPacket[]>(
    `SELECT p.estatus, COUNT(*) AS cuantos FROM pedidos_mostrador p
      WHERE ${clausula} AND (${CONDICION_SALIO_DE_CAPTURA} OR p.estatus = 'borrador')
      GROUP BY p.estatus`,
    parametros
  );

  const porEstatus = Object.fromEntries(ESTATUS_PEDIDO.map((e) => [e, 0])) as Record<EstatusPedido, number>;
  for (const fila of conteos) {
    const estatus = String(fila.estatus) as EstatusPedido;
    if (estatus in porEstatus) porEstatus[estatus] = Number(fila.cuantos);
  }

  return { pedidos: filas.map(aResumen), total: Number(totales[0]?.total ?? 0), porEstatus };
}

/** Últimos pedidos (ya enviados: con folio) de un celular, para que Vico le
 *  diga al cliente cómo van. Los borradores van por obtenerBorrador y los
 *  descartados (cancelados sin folio) no son pedidos. */
export async function ultimosPedidosDeTelefono(
  telefono: string,
  limite: number = ULTIMOS_PEDIDOS_DEFAULT
): Promise<PedidoResumen[]> {
  await asegurarEsquema();
  const limpio = telefono.trim();
  if (!limpio) return [];
  const tope = Number.isInteger(limite) && limite > 0 ? Math.min(limite, ULTIMOS_PEDIDOS_MAX) : ULTIMOS_PEDIDOS_DEFAULT;
  const [filas] = await poolConversaciones().query<RowDataPacket[]>(
    `SELECT ${COLUMNAS_PEDIDO}
       FROM pedidos_mostrador p
      WHERE p.telefono = ? AND ${CONDICION_SALIO_DE_CAPTURA}
      ORDER BY p.id DESC
      LIMIT ?`,
    [limpio, tope]
  );
  return filas.map(aResumen);
}

/**
 * El actor descarta su borrador (botón "Descartar" del mostrador o "cancela
 * el pedido" antes de enviarlo). Queda cancelado con su bitácora, nunca se
 * borra. false si no había borrador que cancelar: para quien llama es lo
 * mismo, ya no hay captura viva.
 */
export async function cancelarBorrador(
  actor: ActorCaptura,
  canal: CanalPedido,
  motivo: string = "Borrador descartado"
): Promise<boolean> {
  await asegurarEsquema();
  const { momento } = ahoraMonterrey();

  return enTransaccion(async (conexion) => {
    const previo = await bloquearBorradorDe(conexion, actor);
    if (!previo) return false;
    await cancelarBorradorPrevio(conexion, previo, usuarioDe(actor), canal, motivo, momento);
    return true;
  });
}
