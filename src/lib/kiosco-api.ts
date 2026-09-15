import type { SesionKiosco } from "@/lib/auth-kiosco";
import type { ArticuloParaPedido } from "@/lib/articulos-pedido";
import type { ClienteDescuento } from "@/lib/clientes-descuento";
import type { ActorCaptura, DatosBorrador } from "@/lib/db-pedidos";
import {
  excedeLimite,
  podarIntentos,
  registrarIntento,
  type LimiteIntentos,
  type RegistroIntentos,
} from "@/lib/limite-intentos";
import type { CanalPedido, PartidaPedido, PedidoDetalle } from "@/lib/pedidos";
import type { ProductoMencionado } from "@/lib/productos-mencionados";
import type { ActorVendedor } from "@/lib/vendedor-pedidos";

// Lo que comparten las rutas /api/kiosco/*: el canal con el que nacen sus
// pedidos, los actores del aparato y —lo importante— las PROYECCIONES de lo
// que el kiosco puede ver.
//
// El kiosco está en el piso de la refaccionaria, sin sesión y sin nadie
// vigilándolo: todo lo que estas funciones dejen salir lo lee quien se pare
// enfrente. Por eso ninguna respuesta lleva el id del pedido, la bitácora, lo
// del POS, el costo, la localización ni la existencia EXACTA: la existencia se
// reduce a `hayEnTienda`, que es lo único que el cliente necesita saber
// ("recógela hoy" o "sobre pedido").

/** Todo lo que entra por estas rutas lo captura el aparato del piso. */
export const CANAL_KIOSCO: CanalPedido = "kiosco";
/** Área con la que se firman los errores en el log del motor. */
export const AREA_KIOSCO = "kiosco";
/** Usuario con el que se firman los eventos del pedido (no hay vendedor
 *  detrás: capturado_por se queda NULL). Mismo literal que la capa de datos. */
export const USUARIO_KIOSCO = "kiosco";
/** El cliente todavía no dice quién es: el pedido nace como público general y
 *  la pantalla le pone nombre y celular al enviarlo. */
export const CLIENTE_KIOSCO = "Público general";

export const ERROR_SIN_PEDIDO_KIOSCO = "Todavía no tienes piezas en tu pedido";

/** Cabecera del borrador del kiosco, en la sucursal del aparato. Sin cliente:
 *  público general, sin padrón ni descuento. Con el cliente que entró con su
 *  celular, gana él: el pedido nace a su nombre, con su celular y su
 *  descuento del padrón. Es la MISMA que arma Vico en vendedor-pedidos.ts:
 *  los dos caminos tienen que abrir el mismo pedido. */
export function datosBorradorKiosco(sesion: SesionKiosco, cliente: ClienteDescuento | null = null): DatosBorrador {
  return {
    canal: CANAL_KIOSCO,
    idCliente: cliente?.id ?? null,
    cliente: cliente?.cliente ?? CLIENTE_KIOSCO,
    telefono: cliente?.telefono ?? null,
    descuentoPct: cliente?.descuento ?? 0,
    sucursal: sesion.sucursal,
  };
}

/** Dueño del borrador: el APARATO (clave 'k:<kiosco>'), no quien lo teclea. */
export function actorCapturaKiosco(sesion: SesionKiosco): ActorCaptura {
  return { tipo: "kiosco", kiosco: sesion.kiosco };
}

/** El mismo aparato, como actor de Vico (lleva la sucursal para el pedido y,
 *  si alguien entró con su celular, a quién atiende y con qué descuento). */
export function actorVicoKiosco(sesion: SesionKiosco, cliente: ClienteDescuento | null = null): ActorVendedor {
  return {
    tipo: "kiosco",
    kiosco: sesion.kiosco,
    sucursal: sesion.sucursal,
    cliente: cliente ? { idCliente: cliente.id, nombre: cliente.cliente, descuento: cliente.descuento } : null,
  };
}

// ---------------------------------------------------------------------------
// Proyecciones (puras).
// ---------------------------------------------------------------------------

export interface PartidaKiosco {
  idPartida: number;
  origen: PartidaPedido["origen"];
  codigo: string | null;
  idPiezaUsada: number | null;
  descripcion: string;
  cantidad: number;
  precioConIva: number;
  importe: number;
  /** ¿Alcanza lo que hay en tienda para lo que pidió? Nunca el número. */
  hayEnTienda: boolean;
}

export interface PedidoKiosco {
  piezas: number;
  /** IVA incluido. */
  total: number;
  partidas: PartidaKiosco[];
}

/** Lo que la pantalla del kiosco sabe de una pieza: si la hay o va sobre pedido. */
function hayEnTienda(existencia: number | null, cantidad: number): boolean {
  return existencia !== null && existencia >= cantidad;
}

function partidaParaKiosco(partida: PartidaPedido): PartidaKiosco {
  return {
    idPartida: partida.id,
    origen: partida.origen,
    codigo: partida.codigo,
    idPiezaUsada: partida.idPiezaUsada,
    descripcion: partida.descripcion,
    cantidad: partida.cantidad,
    precioConIva: partida.precioUnitario,
    importe: partida.importe,
    hayEnTienda: hayEnTienda(partida.existenciaAlPedir, partida.cantidad),
  };
}

/** El borrador del aparato tal como lo ve la pantalla; null si no hay. */
export function pedidoParaKiosco(pedido: PedidoDetalle | null): PedidoKiosco | null {
  if (!pedido) return null;
  return {
    piezas: pedido.partidas.reduce((suma, p) => suma + p.cantidad, 0),
    total: pedido.total,
    partidas: pedido.partidas.map(partidaParaKiosco),
  };
}

export interface AcuseKiosco {
  folio: string | null;
  piezas: number;
  total: number;
}

/** Acuse del envío: el folio que se pasa al mostrador, las piezas y el total. */
export function acuseParaKiosco(pedido: PedidoDetalle): AcuseKiosco {
  return {
    folio: pedido.folio,
    piezas: pedido.partidas.reduce((suma, p) => suma + p.cantidad, 0),
    total: pedido.total,
  };
}

export interface ArticuloKiosco {
  codigo: string;
  descripcion: string;
  /** Precio de mostrador CON IVA (el kiosco nunca cotiza con descuento de padrón). */
  precioConIva: number;
  hayEnTienda: boolean;
  marca: string;
  tipoParte: string;
}

/** Resultado del buscador, sin costo, sin localización y sin existencia exacta. */
export function articuloParaKiosco(articulo: ArticuloParaPedido): ArticuloKiosco {
  return {
    codigo: articulo.codigo,
    descripcion: articulo.descripcion,
    precioConIva: articulo.precioConIva,
    hayEnTienda: articulo.existencia > 0,
    marca: articulo.marca,
    tipoParte: articulo.tipoParte,
  };
}

export interface ProductoKiosco {
  origen: ProductoMencionado["origen"];
  codigo: string;
  idPiezaUsada: number | null;
  descripcion: string;
  precioConIva: number;
  hayEnTienda: boolean;
  foto: string | null;
}

/** Lo que Vico mencionó en el turno, para el botón "Agregar", con el mismo recorte. */
export function productoParaKiosco(producto: ProductoMencionado): ProductoKiosco {
  return {
    origen: producto.origen,
    codigo: producto.codigo,
    idPiezaUsada: producto.idPiezaUsada,
    descripcion: producto.descripcion,
    precioConIva: producto.precioConIva,
    hayEnTienda: producto.existencia > 0,
    foto: producto.foto,
  };
}

// ---------------------------------------------------------------------------
// Topes por aparato (en memoria, como el resto de los límites del motor).
// ---------------------------------------------------------------------------

/** Envíos de pedido por kiosco y por hora: un cliente honesto manda uno. */
export const LIMITE_ENVIOS_KIOSCO: LimiteIntentos = { maximo: 20, ventanaMs: 60 * 60 * 1000 };
/** Mensajes a Vico por kiosco y por minuto (mismo tope que el mostrador). */
export const LIMITE_VICO_KIOSCO: LimiteIntentos = { maximo: 20, ventanaMs: 60 * 1000 };

export interface Cupo {
  /** ¿Cabe otro? true lo anota y deja pasar; false = ya se pasó del tope. */
  intentar(clave: string, ahora?: number): boolean;
  /** Claves vivas (para la prueba de que el registro no crece sin fin). */
  tamano(): number;
}

/**
 * Cupo por clave con ventana deslizante, sobre el mismo registro que frena la
 * fuerza bruta del login (limite-intentos.ts). Vive en el proceso: se reinicia
 * con el servidor y no se comparte entre instancias, que es justo lo que hace
 * falta para un puñado de aparatos en una tienda.
 */
export function crearCupo(limite: LimiteIntentos): Cupo {
  const registro: RegistroIntentos = new Map();
  return {
    intentar(clave: string, ahora = Date.now()): boolean {
      // Se poda en cada intento: son pocas claves (una por aparato) y así un
      // kiosco que se dio de baja no se queda ocupando memoria para siempre.
      podarIntentos(registro, limite, ahora);
      if (excedeLimite(registro, clave, limite, ahora)) return false;
      registrarIntento(registro, clave, limite, ahora);
      return true;
    },
    tamano: () => registro.size,
  };
}

export const ERROR_CUPO_ENVIOS = "Ya se mandaron muchos pedidos desde esta pantalla; pídele ayuda al mostrador";
export const ERROR_CUPO_VICO = "Vas muy rápido para Vico; espera un momento y vuelve a preguntar";
