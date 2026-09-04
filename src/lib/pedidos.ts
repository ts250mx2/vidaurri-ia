// Pedidos de mostrador (fase 1: mostrador + WhatsApp): tipos, reglas de
// dominio y validación de lo que entra por la API. Módulo PURO, sin base de
// datos: lo comparten la capa de datos (db-pedidos.ts), las rutas
// /api/mostrador/*, las herramientas de Vico y vidaurri-page (que copia los
// tipos públicos tal cual en src/lib/mostrador/tipos.ts).

import { limpiarTexto } from "./clientes-descuento";

export type EstatusPedido =
  | "borrador"
  | "enviado"
  | "confirmado"
  | "listo"
  | "entregado"
  | "cancelado";
export type CanalPedido = "mostrador" | "whatsapp" | "web";
export type SucursalEntrega = "matriz" | "fierro";
export type OrigenPartida = "nueva" | "usada" | "sobre_pedido";
export type EstatusPartida = "pendiente" | "confirmada" | "sin_existencia" | "sobre_pedido";
export type PerfilPos = "Administrador" | "Operaciones" | "Ventas";
/** Cómo va la cotización del pedido en el POS (bdav): pendiente mientras no
 *  esté listo; simulada cuando el módulo corre en modo simulación; insertada
 *  con num_cotiza real; omitida con el módulo apagado o sin nada que cotizar;
 *  error con el mensaje en cotizaPosError; cancelada al cancelar el pedido. */
export type EstadoCotizaPos = "pendiente" | "simulada" | "insertada" | "omitida" | "error" | "cancelada";

export const ESTATUS_PEDIDO: ReadonlyArray<EstatusPedido> = [
  "borrador",
  "enviado",
  "confirmado",
  "listo",
  "entregado",
  "cancelado",
];
export const CANALES_PEDIDO: ReadonlyArray<CanalPedido> = ["mostrador", "whatsapp", "web"];
export const ORIGENES_PARTIDA: ReadonlyArray<OrigenPartida> = ["nueva", "usada", "sobre_pedido"];
export const ESTATUS_PARTIDA: ReadonlyArray<EstatusPartida> = [
  "pendiente",
  "confirmada",
  "sin_existencia",
  "sobre_pedido",
];
export const PERFILES_POS: ReadonlyArray<PerfilPos> = ["Administrador", "Operaciones", "Ventas"];
export const ESTADOS_COTIZA_POS: ReadonlyArray<EstadoCotizaPos> = [
  "pendiente",
  "simulada",
  "insertada",
  "omitida",
  "error",
  "cancelada",
];

export const SUCURSALES_ENTREGA: ReadonlyArray<{ clave: SucursalEntrega; nombre: string }> = [
  { clave: "matriz", nombre: "Matriz" },
  { clave: "fierro", nombre: "Sucursal Fierro" },
];

/** Multiplicador del IVA. El precio unitario guardado en la partida YA lo
 *  incluye: solo sirve para desglosar subtotal e IVA a partir del total. */
export const IVA_PEDIDOS = 1.16;
export const CANTIDAD_MAX = 99;
export const PARTIDAS_MAX = 30;
export const OBSERVACIONES_MAX = 500;
/** Largo del folio 'P-000131' con el relleno mínimo de dígitos. */
export const FOLIO_DIGITOS = 6;
/** Columnas VARCHAR de las tablas de pedidos (db-conversaciones.ts). */
export const CODIGO_MAX = 20;
export const MOTIVO_MAX = 200;
export const NOTA_MAX = 200;
export const FOLIO_VENTA_POS_MAX = 20;
export const USUARIO_MAX = 50;
/** Plazo máximo que el mostrador promete en una pieza sobre pedido. */
export const DIAS_ENTREGA_MAX = 365;
/** Paginación de la cola de pedidos: tamaño fijo, como en el resto del panel. */
export const POR_PAGINA_PEDIDOS = 50;
export const PAGINA_MAX_PEDIDOS = 10000;
/** Tope del tamaño de página (y lo que significa "todos"): la cola cabe entera en una vuelta. */
export const POR_PAGINA_MAX_PEDIDOS = 1000;
export const POR_PAGINA_MIN_PEDIDOS = 10;
export const BUSQUEDA_MAX = 80;

// ---------------------------------------------------------------------------
// Tipos públicos (la API los devuelve y vidaurri-page los copia tal cual).
// ---------------------------------------------------------------------------

export interface PartidaPedido {
  id: number;
  /** Renglón 1..n dentro del pedido. */
  partida: number;
  origen: OrigenPartida;
  /** articulos.codigo de bdav (nueva / sobre_pedido); null en usadas. */
  codigo: string | null;
  /** piezas.id_pieza de la Bodega Usado (usada); null en nuevas. */
  idPiezaUsada: number | null;
  descripcion: string;
  cantidad: number;
  /** IVA incluido, ya con el descuento del cliente. */
  precioUnitario: number;
  /** cantidad * precioUnitario. */
  importe: number;
  existenciaAlPedir: number | null;
  estatusPartida: EstatusPartida;
  /** Solo sobre_pedido: días que promete el mostrador. */
  diasEntrega: number | null;
  nota: string | null;
}

export interface EventoPedido {
  id: number;
  evento: string;
  estatusAnterior: EstatusPedido | null;
  estatusNuevo: EstatusPedido | null;
  detalle: string | null;
  /** Usuario del POS o "cliente". */
  usuario: string | null;
  canal: CanalPedido;
  creadoEn: string;
}

export interface PedidoResumen {
  id: number;
  /** 'P-000131'; null mientras es borrador. */
  folio: string | null;
  estatus: EstatusPedido;
  canal: CanalPedido;
  /** clientes_descuento.id; null = público general. */
  idCliente: number | null;
  /** clientes.id en bdav (el ID que ve el POS), si el cliente del padrón está ligado; null si no. */
  idClienteBdav: number | null;
  /** Nombre del cliente al momento del pedido (snapshot). */
  cliente: string;
  telefono: string | null;
  descuentoPct: number;
  sucursal: SucursalEntrega;
  capturadoPor: string | null;
  atendidoPor: string | null;
  subtotal: number;
  iva: number;
  /** IVA incluido; suma de importes. */
  total: number;
  /** Conteo de renglones (en el detalle `partidas` es el arreglo). */
  numPartidas: number;
  /** num_cotiza de la cotización en el POS; null mientras no se inserte. */
  numCotizaPos: number | null;
  cotizaPosEstado: EstadoCotizaPos;
  /** Por qué falló la cotización en el POS (o, en simulación, el resumen de lo que se habría insertado). */
  cotizaPosError: string | null;
  creadoEn: string;
  enviadoEn: string | null;
  confirmadoEn: string | null;
  listoEn: string | null;
  entregadoEn: string | null;
  canceladoEn: string | null;
  actualizadoEn: string;
}

export interface PedidoDetalle extends PedidoResumen {
  observaciones: string | null;
  /** Folio de la venta en el POS al entregar (referencia, solo lectura). */
  folioVentaPos: string | null;
  motivoCancelacion: string | null;
  partidas: PartidaPedido[];
  eventos: EventoPedido[];
}

export interface FiltrosPedidos {
  estatus?: EstatusPedido;
  sucursal?: SucursalEntrega;
  canal?: CanalPedido;
  /** Usuario del POS que capturó o atendió. */
  usuario?: string;
  /** 'AAAA-MM-DD' (fecha de creación, horario de Monterrey). */
  desde?: string;
  hasta?: string;
  /** Folio, nombre del cliente o teléfono. */
  busqueda?: string;
  pagina: number;
  porPagina: number;
}

export interface PaginaPedidos {
  pedidos: PedidoResumen[];
  total: number;
  porEstatus: Record<EstatusPedido, number>;
}

// ---------------------------------------------------------------------------
// Reglas de dominio.
// ---------------------------------------------------------------------------

/** Folio público del pedido a partir de su id: 131 -> 'P-000131'. Con más de
 *  seis dígitos el folio crece (VARCHAR(12) da para cien millones). */
export function folioDeId(id: number): string {
  return `P-${String(id).padStart(FOLIO_DIGITOS, "0")}`;
}

export function esEstatusPedido(x: unknown): x is EstatusPedido {
  return typeof x === "string" && (ESTATUS_PEDIDO as ReadonlyArray<string>).includes(x);
}

export function esSucursal(x: unknown): x is SucursalEntrega {
  return SUCURSALES_ENTREGA.some((s) => s.clave === x);
}

export function esCanalPedido(x: unknown): x is CanalPedido {
  return typeof x === "string" && (CANALES_PEDIDO as ReadonlyArray<string>).includes(x);
}

export function esOrigenPartida(x: unknown): x is OrigenPartida {
  return typeof x === "string" && (ORIGENES_PARTIDA as ReadonlyArray<string>).includes(x);
}

export function esEstatusPartida(x: unknown): x is EstatusPartida {
  return typeof x === "string" && (ESTATUS_PARTIDA as ReadonlyArray<string>).includes(x);
}

/** Perfil del POS con el que se deciden permisos. Un perfil que no conocemos
 *  (o vacío) se trata como Ventas: mínimo privilegio. */
export function perfilDe(sesion: { perfil: string }): PerfilPos {
  return (PERFILES_POS as ReadonlyArray<string>).includes(sesion.perfil)
    ? (sesion.perfil as PerfilPos)
    : "Ventas";
}

const TODOS: ReadonlyArray<PerfilPos> = ["Ventas", "Operaciones", "Administrador"];
const SUPERVISORES: ReadonlyArray<PerfilPos> = ["Operaciones", "Administrador"];

/**
 * Matriz de transiciones: para cada estatus de origen, a cuáles se puede pasar
 * y qué perfiles pueden hacerlo. borrador -> enviado NO está aquí a propósito:
 * lo hace quien captura (vendedor o cliente) por enviarPedido de la capa de
 * datos, sin pasar por el perfil. Cancelar un pedido que ya se confirmó o ya
 * está surtido deshace trabajo del almacén, por eso solo Operaciones y
 * Administrador. entregado y cancelado son finales.
 */
const TRANSICIONES: Readonly<
  Record<EstatusPedido, Readonly<Partial<Record<EstatusPedido, ReadonlyArray<PerfilPos>>>>>
> = {
  borrador: {},
  enviado: { confirmado: TODOS, cancelado: TODOS },
  confirmado: { listo: TODOS, cancelado: SUPERVISORES },
  listo: { entregado: TODOS, cancelado: SUPERVISORES },
  entregado: {},
  cancelado: {},
};

/** Transiciones válidas y quién puede hacerlas. */
export function puedeCambiarEstatus(perfil: PerfilPos, de: EstatusPedido, a: EstatusPedido): boolean {
  const permitidos = TRANSICIONES[de][a];
  return permitidos !== undefined && permitidos.includes(perfil);
}

/** El cliente solo puede echar atrás lo que el mostrador todavía no trabajó. */
export function puedeCancelarCliente(estatus: EstatusPedido): boolean {
  return estatus === "borrador" || estatus === "enviado";
}

/**
 * Un pedido se puede editar (partidas, cantidades, sucursal, observaciones)
 * mientras el mostrador no lo haya surtido: cualquier perfil del POS puede
 * hacerlo en borrador, enviado y confirmado; listo, entregado y cancelado ya
 * no cambian.
 */
export function puedeEditarPedido(estatus: EstatusPedido): boolean {
  return estatus === "borrador" || estatus === "enviado" || estatus === "confirmado";
}

/**
 * Al cambiar la cantidad de un renglón (o sumarle piezas) lo que el mostrador
 * ya dijo de él deja de valer, así que vuelve a pendiente para que lo revisen
 * otra vez: siempre en un pedido confirmado, y en cualquier estatus si la
 * partida ya estaba revisada (confirmada, sin existencia o sobre pedido). En
 * un borrador nunca: ahí nadie la ha revisado todavía.
 */
export function partidaVuelveAPendiente(estatusPedido: EstatusPedido, estatusPartida: EstatusPartida): boolean {
  return estatusPedido === "confirmado" || estatusPartida !== "pendiente";
}

/**
 * Quién puede fijar el descuento de un cliente al darlo de alta desde el
 * mostrador. Ventas captura con el descuento por defecto: dejarle mandar el
 * porcentaje sería dejarle fijar el precio del pedido, cosa que el POS no le
 * permite.
 */
export function puedeFijarDescuento(perfil: PerfilPos): boolean {
  return SUPERVISORES.includes(perfil);
}

/**
 * Una pieza usada es una unidad física ("pieza única"): no se puede pedir
 * más de lo que hay en la Bodega. Devuelve el mensaje para el usuario si la
 * cantidad (la acumulada del renglón) rebasa la existencia, o null si cabe.
 * Sin existencia conocida no se acota: la Bodega ya la exigió > 0 al cotizar.
 */
export function errorCantidadUsada(existencia: number | null, cantidad: number): string | null {
  if (existencia === null || cantidad <= existencia) return null;
  return existencia === 1
    ? "De esa pieza usada solo hay una: pide a lo más 1"
    : `De esa pieza usada solo hay ${existencia}: pide a lo más ${existencia}`;
}

/**
 * Lo que el mostrador NO puede decir de un renglón al confirmarlo: una pieza
 * usada nunca va sobre pedido (no hay proveedor al que pedirla). Devuelve el
 * mensaje para el usuario o null si la combinación es válida.
 */
export function errorConfirmacionPartida(origen: OrigenPartida, estatusPartida: EstatusPartida): string | null {
  if (origen === "usada" && estatusPartida === "sobre_pedido") {
    return "Una pieza usada no puede ir sobre pedido";
  }
  return null;
}

/** Dos decimales, como se guardan las cifras (DECIMAL(11,2)). */
export function redondear2(x: number): number {
  return Math.round(x * 100) / 100;
}

/**
 * Totales desde las partidas. El precio unitario ya trae IVA, así que el
 * total es la suma de importes y el subtotal se desglosa hacia atrás; el IVA
 * es la diferencia para que subtotal + iva cuadre siempre con el total.
 */
export function calcularTotales(
  partidas: Array<{ cantidad: number; precioUnitario: number }>
): { subtotal: number; iva: number; total: number } {
  // La suma de importes ya redondeados se vuelve a redondear solo para limpiar
  // el ruido binario (0.1 + 0.2): no cambia el valor, cambia 4156.660000001.
  const total = redondear2(partidas.reduce((suma, p) => suma + redondear2(p.cantidad * p.precioUnitario), 0));
  const subtotal = redondear2(total / IVA_PEDIDOS);
  const iva = redondear2(total - subtotal);
  return { subtotal, iva, total };
}

// ---------------------------------------------------------------------------
// Validación de lo que entra por la API (funciones puras, mensajes para el
// usuario). Ninguna confía en el cuerpo: viene de PAGE o del modelo.
// ---------------------------------------------------------------------------

export interface CapturaPartida {
  origen: OrigenPartida;
  codigo: string | null;
  idPiezaUsada: number | null;
  cantidad: number;
}

type Validacion<T> = { ok: true; datos: T } | { ok: false; error: string };

function esObjeto(entrada: unknown): entrada is Record<string, unknown> {
  return !!entrada && typeof entrada === "object" && !Array.isArray(entrada);
}

/** Entero positivo seguro escrito en decimal ('12', 12; no '012', 1e20, 0x1F).
 *  null = vacío; undefined = inválido. */
function leerEnteroPositivo(crudo: unknown): number | null | undefined {
  if (crudo == null || crudo === "") return null;
  if (typeof crudo === "string") {
    const texto = crudo.trim();
    if (!/^[1-9]\d{0,14}$/.test(texto)) return undefined;
    return Number(texto);
  }
  if (typeof crudo !== "number" || !Number.isSafeInteger(crudo) || crudo <= 0) return undefined;
  return crudo;
}

/** Texto opcional limpio y acotado: null si viene vacío; undefined si se pasa. */
function leerTextoOpcional(crudo: unknown, maximo: number): string | null | undefined {
  if (crudo == null) return null;
  const texto = limpiarTexto(String(crudo));
  if (!texto) return null;
  return texto.length > maximo ? undefined : texto;
}

/** Códigos de bdav: letras, dígitos y . _ / - ; sin espacios dentro. */
const CODIGO_VALIDO = /^[A-Za-z0-9._/-]+$/;

function leerCodigo(crudo: unknown): string | null | undefined {
  if (crudo == null) return null;
  const texto = String(crudo).trim().toUpperCase();
  if (!texto) return null;
  if (texto.length > CODIGO_MAX || !CODIGO_VALIDO.test(texto)) return undefined;
  return texto;
}

const ERROR_CANTIDAD = `La cantidad debe ser un entero entre 1 y ${CANTIDAD_MAX}`;
const ERROR_OBSERVACIONES = `Las observaciones no pueden pasar de ${OBSERVACIONES_MAX} caracteres`;
const ERROR_SUCURSAL = "Sucursal inválida";

/** Cantidad de un renglón: entero 1..CANTIDAD_MAX (número o cadena de dígitos); undefined si no vale. */
function leerCantidad(crudo: unknown): number | undefined {
  const cantidad = leerEnteroPositivo(crudo);
  return cantidad && cantidad <= CANTIDAD_MAX ? cantidad : undefined;
}

/**
 * Renglón que se agrega al borrador. Tiene que traer exactamente UNA
 * referencia: código de bdav (nueva / sobre pedido) o id de pieza usada. El
 * origen puede venir explícito (y entonces debe ser coherente con la
 * referencia) u omitirse: Vico solo manda código o id, y se deduce de ahí.
 * "sobre_pedido" nunca se deduce: eso lo decide el mostrador al confirmar.
 */
export function validarCapturaPartida(entrada: unknown): Validacion<CapturaPartida> {
  if (!esObjeto(entrada)) return { ok: false, error: "Petición inválida" };

  const codigo = leerCodigo(entrada.codigo);
  if (codigo === undefined) return { ok: false, error: "Código de pieza inválido" };

  const idPiezaUsada = leerEnteroPositivo(entrada.idPiezaUsada);
  if (idPiezaUsada === undefined) return { ok: false, error: "Pieza usada inválida" };

  if (codigo && idPiezaUsada) {
    return { ok: false, error: "Indica el código de la pieza nueva o el id de la usada, no ambos" };
  }
  if (!codigo && !idPiezaUsada) {
    return { ok: false, error: "Indica el código de la pieza nueva o el id de la usada" };
  }

  const origenDeducido: OrigenPartida = idPiezaUsada ? "usada" : "nueva";
  const origenCrudo = entrada.origen;
  let origen: OrigenPartida = origenDeducido;
  if (origenCrudo != null && origenCrudo !== "") {
    if (!esOrigenPartida(origenCrudo)) return { ok: false, error: "Origen de la partida inválido" };
    const pideUsada = origenCrudo === "usada";
    if (pideUsada !== Boolean(idPiezaUsada)) {
      return { ok: false, error: "El origen no corresponde con la pieza indicada" };
    }
    origen = origenCrudo;
  }

  const cantidad = leerCantidad(entrada.cantidad);
  if (cantidad === undefined) return { ok: false, error: ERROR_CANTIDAD };

  return { ok: true, datos: { origen, codigo, idPiezaUsada, cantidad } };
}

export interface CambioEstatus {
  estatus: EstatusPedido;
  motivo: string | null;
  folioVentaPos: string | null;
}

/** Cuerpo de POST /pedidos/[id]/estatus. Si la transición se permite la
 *  decide puedeCambiarEstatus con el perfil, no este validador. */
export function validarCambioEstatus(entrada: unknown): Validacion<CambioEstatus> {
  if (!esObjeto(entrada)) return { ok: false, error: "Petición inválida" };

  if (!esEstatusPedido(entrada.estatus)) return { ok: false, error: "Estatus inválido" };

  const motivo = leerTextoOpcional(entrada.motivo, MOTIVO_MAX);
  if (motivo === undefined) {
    return { ok: false, error: `El motivo no puede pasar de ${MOTIVO_MAX} caracteres` };
  }

  const folioVentaPos = leerTextoOpcional(entrada.folioVentaPos, FOLIO_VENTA_POS_MAX);
  if (folioVentaPos === undefined) {
    return { ok: false, error: `El folio de venta no puede pasar de ${FOLIO_VENTA_POS_MAX} caracteres` };
  }

  return { ok: true, datos: { estatus: entrada.estatus, motivo, folioVentaPos } };
}

export interface ConfirmacionPartida {
  id: number;
  estatusPartida: EstatusPartida;
  diasEntrega: number | null;
  nota: string | null;
}

function validarConfirmacionPartida(crudo: unknown, renglon: number): Validacion<ConfirmacionPartida> {
  if (!esObjeto(crudo)) return { ok: false, error: `Partida ${renglon}: renglón inválido` };

  const id = leerEnteroPositivo(crudo.id);
  if (!id) return { ok: false, error: `Partida ${renglon}: id inválido` };

  if (!esEstatusPartida(crudo.estatusPartida)) {
    return { ok: false, error: `Partida ${renglon}: estatus inválido` };
  }

  // Los días de entrega solo tienen sentido sobre pedido; en cualquier otro
  // estatus se descartan en silencio para que la pantalla pueda mandar el
  // renglón completo sin limpiar campos.
  const dias = crudo.estatusPartida === "sobre_pedido" ? leerEnteroPositivo(crudo.diasEntrega) : null;
  if (dias === undefined || (dias !== null && dias > DIAS_ENTREGA_MAX)) {
    return {
      ok: false,
      error: `Partida ${renglon}: los días de entrega deben ser un entero entre 1 y ${DIAS_ENTREGA_MAX}`,
    };
  }
  const diasEntrega: number | null = dias;

  const nota = leerTextoOpcional(crudo.nota, NOTA_MAX);
  if (nota === undefined) {
    return { ok: false, error: `Partida ${renglon}: la nota no puede pasar de ${NOTA_MAX} caracteres` };
  }

  return { ok: true, datos: { id, estatusPartida: crudo.estatusPartida, diasEntrega, nota } };
}

/** Cuerpo de POST /pedidos/[id]/partidas/confirmar: `{ partidas: [...] }`. */
export function validarConfirmacionPartidas(entrada: unknown): Validacion<ConfirmacionPartida[]> {
  if (!esObjeto(entrada) || !Array.isArray(entrada.partidas)) {
    return { ok: false, error: "Petición inválida" };
  }
  const crudas: unknown[] = entrada.partidas;
  if (crudas.length === 0) return { ok: false, error: "No hay partidas que confirmar" };
  if (crudas.length > PARTIDAS_MAX) {
    return { ok: false, error: `Un pedido no puede tener más de ${PARTIDAS_MAX} partidas` };
  }

  const datos: ConfirmacionPartida[] = [];
  for (const [indice, cruda] of crudas.entries()) {
    const resultado = validarConfirmacionPartida(cruda, indice + 1);
    if (!resultado.ok) return resultado;
    if (datos.some((p) => p.id === resultado.datos.id)) {
      return { ok: false, error: `Partida ${indice + 1}: id repetido` };
    }
    datos.push(resultado.datos);
  }
  return { ok: true, datos };
}

const ES_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Filtros de la cola desde el querystring. Acota y normaliza, nunca falla:
 * lo que no se entiende se ignora y la cola sale sin ese filtro, que es lo
 * que espera una pantalla que arma la URL a mano.
 */
export function validarFiltrosPedidos(sp: Record<string, string | undefined>): FiltrosPedidos {
  const usuario = limpiarTexto(sp.usuario ?? "").slice(0, USUARIO_MAX);
  const busqueda = limpiarTexto(sp.busqueda ?? "").slice(0, BUSQUEDA_MAX);

  // Un rango al revés se endereza en vez de devolver una cola vacía.
  const desdeCrudo = ES_FECHA.test(sp.desde ?? "") ? sp.desde : undefined;
  const hastaCrudo = ES_FECHA.test(sp.hasta ?? "") ? sp.hasta : undefined;
  const alReves = desdeCrudo !== undefined && hastaCrudo !== undefined && desdeCrudo > hastaCrudo;
  const desde = alReves ? hastaCrudo : desdeCrudo;
  const hasta = alReves ? desdeCrudo : hastaCrudo;

  // Las claves ausentes no se incluyen (ni como undefined) para que el objeto
  // sea comparable tal cual y la capa de datos solo vea filtros reales.
  return {
    ...(esEstatusPedido(sp.estatus) ? { estatus: sp.estatus } : {}),
    ...(esSucursal(sp.sucursal) ? { sucursal: sp.sucursal } : {}),
    ...(esCanalPedido(sp.canal) ? { canal: sp.canal } : {}),
    ...(usuario ? { usuario } : {}),
    ...(desde !== undefined ? { desde } : {}),
    ...(hasta !== undefined ? { hasta } : {}),
    ...(busqueda ? { busqueda } : {}),
    pagina: leerPagina(sp.pagina),
    porPagina: leerPorPagina(sp.porPagina),
  };
}

/** `porPagina`: número entre 10 y 1000, o la palabra "todos" (= el tope); cualquier otra cosa → 50. */
function leerPorPagina(crudo: string | undefined): number {
  const texto = (crudo ?? "").trim().toLowerCase();
  if (texto === "todos") return POR_PAGINA_MAX_PEDIDOS;
  if (!/^\d{1,4}$/.test(texto)) return POR_PAGINA_PEDIDOS;
  return Math.min(POR_PAGINA_MAX_PEDIDOS, Math.max(POR_PAGINA_MIN_PEDIDOS, Number.parseInt(texto, 10)));
}

function leerPagina(crudo: string | undefined): number {
  const numero = Number.parseInt(crudo ?? "1", 10) || 1;
  return Math.min(PAGINA_MAX_PEDIDOS, Math.max(1, numero));
}

// ---------------------------------------------------------------------------
// Cuerpos del borrador del vendedor (POST /borrador y POST /borrador/enviar).
// ---------------------------------------------------------------------------

/** Sucursal opcional del cuerpo: null si no viene; undefined si no es válida. */
function leerSucursalOpcional(crudo: unknown): SucursalEntrega | null | undefined {
  if (crudo == null || crudo === "") return null;
  return esSucursal(crudo) ? crudo : undefined;
}

export interface AperturaBorrador {
  /** clientes_descuento.id, o null para público general. */
  idCliente: number | null;
  /** null = la que ya tenga el borrador o la de la casa (matriz). */
  sucursal: SucursalEntrega | null;
}

/** Cuerpo de POST /borrador: `{ idCliente: number | null, sucursal? }`. */
export function validarAperturaBorrador(entrada: unknown): Validacion<AperturaBorrador> {
  if (!esObjeto(entrada)) return { ok: false, error: "Petición inválida" };

  const idCliente = leerEnteroPositivo(entrada.idCliente);
  if (idCliente === undefined) return { ok: false, error: "Cliente inválido" };

  const sucursal = leerSucursalOpcional(entrada.sucursal);
  if (sucursal === undefined) return { ok: false, error: ERROR_SUCURSAL };

  return { ok: true, datos: { idCliente, sucursal } };
}

export interface EnvioBorrador {
  observaciones: string | null;
  sucursal: SucursalEntrega | null;
}

/** Cuerpo de POST /borrador/enviar: `{ observaciones?, sucursal? }`; el cuerpo
 *  vacío es válido (se manda tal cual está el borrador). */
export function validarEnvioBorrador(entrada: unknown): Validacion<EnvioBorrador> {
  const cuerpo = entrada == null ? {} : entrada;
  if (!esObjeto(cuerpo)) return { ok: false, error: "Petición inválida" };

  const observaciones = leerTextoOpcional(cuerpo.observaciones, OBSERVACIONES_MAX);
  if (observaciones === undefined) return { ok: false, error: ERROR_OBSERVACIONES };

  const sucursal = leerSucursalOpcional(cuerpo.sucursal);
  if (sucursal === undefined) return { ok: false, error: ERROR_SUCURSAL };

  return { ok: true, datos: { observaciones, sucursal } };
}

// ---------------------------------------------------------------------------
// Cuerpos de la edición de un pedido (PATCH .../partidas/[idPartida],
// POST .../sucursal, POST .../observaciones). Si el pedido admite el cambio lo
// decide puedeEditarPedido en la capa de datos, con la fila bloqueada.
// ---------------------------------------------------------------------------

/** Cuerpo de PATCH .../partidas/[idPartida]: `{ cantidad }` (número o cadena de dígitos). */
export function validarCantidad(entrada: unknown): Validacion<{ cantidad: number }> {
  if (!esObjeto(entrada)) return { ok: false, error: "Petición inválida" };

  const cantidad = leerCantidad(entrada.cantidad);
  if (cantidad === undefined) return { ok: false, error: ERROR_CANTIDAD };

  return { ok: true, datos: { cantidad } };
}

/** Cuerpo de POST .../observaciones: `{ observaciones }`; vacío o ausente las borra (null). */
export function validarObservaciones(entrada: unknown): Validacion<{ observaciones: string | null }> {
  if (!esObjeto(entrada)) return { ok: false, error: "Petición inválida" };

  const observaciones = leerTextoOpcional(entrada.observaciones, OBSERVACIONES_MAX);
  if (observaciones === undefined) return { ok: false, error: ERROR_OBSERVACIONES };

  return { ok: true, datos: { observaciones } };
}

/** Cuerpo de POST .../sucursal: `{ sucursal }`, obligatoria y del catálogo. */
export function validarSucursal(entrada: unknown): Validacion<{ sucursal: SucursalEntrega }> {
  if (!esObjeto(entrada)) return { ok: false, error: "Petición inválida" };
  if (!esSucursal(entrada.sucursal)) return { ok: false, error: ERROR_SUCURSAL };
  return { ok: true, datos: { sucursal: entrada.sucursal } };
}
