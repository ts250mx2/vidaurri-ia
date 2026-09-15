import type { ClienteDescuento } from "@/lib/clientes-descuento";
import type { PedidoDeCliente } from "@/lib/db-pedidos";
import type { LimiteIntentos } from "@/lib/limite-intentos";
import {
  validarDatosClienteKiosco,
  type EstatusPartida,
  type EstatusPedido,
  type PartidaPedido,
  type PedidoDetalle,
  type PedidoResumen,
  type SucursalEntrega,
} from "@/lib/pedidos";

// El cliente del padrón que entró al kiosco con su celular: lo que la
// pantalla puede saber de él y de SUS pedidos. Igual que en kiosco-api.ts, el
// aparato está en el piso y lo lee quien se pare enfrente, así que estas
// proyecciones se prueban por lo que NO sale: nada de ids internos, bitácora,
// datos del POS, RFC, correo ni existencias exactas.
//
// Entrar es con celular y contraseña (clientes-entrar.ts, la misma cuenta que
// el área de clientes de la web; la primera vez la contraseña es el celular).
// Encima de los topes por usuario y por IP de esa cuenta, el kiosco conserva
// su tope por APARATO (LIMITE_ENTRADAS_KIOSCO): frena el barrido del padrón
// desde una pantalla que cualquiera puede teclear.

/** Intentos de entrar por aparato: 10 cada 10 minutos. Frena el barrido de
 *  celulares contra el padrón sin estorbarle a quien se equivoca un par de
 *  veces. */
export const LIMITE_ENTRADAS_KIOSCO: LimiteIntentos = { maximo: 10, ventanaMs: 10 * 60 * 1000 };
/** Pedidos que se le muestran al cliente en "Mis pedidos". */
export const PEDIDOS_CLIENTE_KIOSCO = 20;

export const ERROR_CUPO_ENTRADAS =
  "Se intentó entrar muchas veces desde esta pantalla; espera unos minutos o pide ayuda en el mostrador";
export const ERROR_PEDIDO_CLIENTE_NO_ENCONTRADO = "No encontramos ese pedido entre los tuyos";
export const ERROR_PEDIDO_DE_OTRO_CLIENTE = "El pedido en pantalla no es de tu cuenta; vuelve a agregar tus piezas";

// ---------------------------------------------------------------------------
// Proyecciones (puras). Lo que responde /cliente/entrar es clienteParaSesion
// (clientes-acceso.ts): la misma forma que /api/clientes/entrar.
// ---------------------------------------------------------------------------

export interface PedidoClienteKiosco {
  folio: string | null;
  estatus: EstatusPedido;
  creadoEn: string;
  enviadoEn: string | null;
  /** IVA incluido. */
  total: number;
  /** Piezas sumadas (no renglones), como en el acuse del kiosco. */
  piezas: number;
  sucursal: SucursalEntrega;
}

export interface PartidaClienteKiosco {
  descripcion: string;
  codigo: string | null;
  cantidad: number;
  /** IVA incluido, ya con el descuento del cliente. */
  precioUnitario: number;
  importe: number;
  estatusPartida: EstatusPartida;
}

export interface PedidoClienteKioscoDetalle extends PedidoClienteKiosco {
  partidas: PartidaClienteKiosco[];
  /** Las que se imprimen en su hoja de pedido; nunca las notas por renglón. */
  observaciones: string | null;
}

function cabeceraParaCliente(pedido: PedidoResumen, piezas: number): PedidoClienteKiosco {
  return {
    folio: pedido.folio,
    estatus: pedido.estatus,
    creadoEn: pedido.creadoEn,
    enviadoEn: pedido.enviadoEn,
    total: pedido.total,
    piezas,
    sucursal: pedido.sucursal,
  };
}

/** Un renglón de "Mis pedidos". */
export function pedidoParaCliente(pedido: PedidoDeCliente): PedidoClienteKiosco {
  return cabeceraParaCliente(pedido, pedido.piezas);
}

function partidaParaCliente(partida: PartidaPedido): PartidaClienteKiosco {
  return {
    descripcion: partida.descripcion,
    codigo: partida.codigo,
    cantidad: partida.cantidad,
    precioUnitario: partida.precioUnitario,
    importe: partida.importe,
    estatusPartida: partida.estatusPartida,
  };
}

/** El detalle de UN pedido del cliente: cabecera, renglones y observaciones. */
export function detalleParaCliente(pedido: PedidoDetalle): PedidoClienteKioscoDetalle {
  const piezas = pedido.partidas.reduce((suma, p) => suma + p.cantidad, 0);
  return {
    ...cabeceraParaCliente(pedido, piezas),
    partidas: pedido.partidas.map(partidaParaCliente),
    observaciones: pedido.observaciones,
  };
}

// ---------------------------------------------------------------------------
// El borrador del aparato frente al cliente que entró.
// ---------------------------------------------------------------------------

/**
 * ¿El borrador vivo del aparato es del cliente de la sesión (o de nadie, si
 * no hay sesión)? Al entrar se descarta el borrador anónimo, así que esto
 * solo falla en una carrera; pero un cliente NUNCA debe seguir sobre el
 * pedido de otro ni mandarlo a su nombre con precios que no son los suyos.
 */
export function esBorradorDelCliente(
  borrador: Pick<PedidoDetalle, "idCliente">,
  cliente: ClienteDescuento | null
): boolean {
  return borrador.idCliente === (cliente?.id ?? null);
}

export type DatosEnvioKiosco =
  | { ok: true; datos: { cliente: string; telefono: string | null } }
  | { ok: false; error: string };

/**
 * Con quién se sella el pedido al enviarlo. Con sesión de cliente, el nombre
 * y el celular son los del PADRÓN y lo que traiga el cuerpo se ignora: el
 * pedido es suyo y nadie teclea otro nombre encima. Sin sesión, los datos
 * tecleados en la pantalla, validados como siempre.
 */
export function datosClienteParaEnvio(cliente: ClienteDescuento | null, cuerpo: unknown): DatosEnvioKiosco {
  if (cliente) return { ok: true, datos: { cliente: cliente.cliente, telefono: cliente.telefono } };
  const validacion = validarDatosClienteKiosco(cuerpo);
  if (!validacion.ok) return validacion;
  return { ok: true, datos: { cliente: validacion.datos.nombre, telefono: validacion.datos.telefono } };
}
