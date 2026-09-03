import { articuloParaPedido, motivoSinArticulo, piezaUsadaParaPedido } from "@/lib/articulos-pedido";
import { exigirMostrador } from "@/lib/auth-mostrador";
import { obtenerClienteDescuento } from "@/lib/db-clientes-descuento";
import { agregarPartida, obtenerBorrador, type PartidaNueva } from "@/lib/db-pedidos";
import {
  CANAL_MOSTRADOR,
  ERROR_SIN_BORRADOR,
  actorDe,
  leerCuerpo,
  respuestaDeError,
  respuestaError,
  respuestaOk,
} from "@/lib/mostrador-api";
import {
  errorCantidadUsada,
  validarCapturaPartida,
  type CapturaPartida,
  type PedidoDetalle,
} from "@/lib/pedidos";

// Agrega un renglón al borrador del vendedor. El precio NUNCA viene del
// cliente HTTP: se cotiza aquí con el descuento ACTUAL del padrón del cliente
// del borrador (la misma fuente que usa Vico en /api/mostrador/vico), así el
// pedido canta lo mismo por los dos caminos.

export const dynamic = "force-dynamic";

type Cotizacion = { ok: true; partida: PartidaNueva } | { ok: false; error: string; status: 400 | 404 };

/**
 * Descuento con el que se cotiza: el del padrón hoy (no el snapshot del
 * borrador, que pudo quedarse atrás si el panel lo cambió con la captura
 * abierta), o mostrador (null) para público general. Si el cliente ya no está
 * en el padrón se cae al snapshot: es lo último que se supo de él.
 */
async function descuentoDe(borrador: PedidoDetalle): Promise<number | null> {
  if (borrador.idCliente === null) return null;
  const cliente = await obtenerClienteDescuento(borrador.idCliente);
  return cliente?.descuento ?? borrador.descuentoPct;
}

async function cotizar(captura: CapturaPartida, borrador: PedidoDetalle): Promise<Cotizacion> {
  if (captura.idPiezaUsada !== null) {
    const pieza = await piezaUsadaParaPedido(captura.idPiezaUsada);
    if (!pieza) return { ok: false, error: "Esa pieza usada ya no está disponible", status: 404 };
    const sobra = errorCantidadUsada(pieza.existencia, captura.cantidad);
    if (sobra) return { ok: false, error: sobra, status: 400 };
    return {
      ok: true,
      partida: {
        origen: "usada",
        codigo: null,
        idPiezaUsada: pieza.idPieza,
        descripcion: [pieza.descripcion, pieza.marca, pieza.modelo].filter(Boolean).join(" · "),
        cantidad: captura.cantidad,
        precioUnitario: pieza.precioConIva,
        existenciaAlPedir: pieza.existencia,
      },
    };
  }

  const descuento = await descuentoDe(borrador);
  const articulo = await articuloParaPedido(captura.codigo ?? "", descuento);
  if (!articulo) {
    const motivo = await motivoSinArticulo(captura.codigo ?? "", descuento);
    return motivo === "sin_precio_lista"
      ? {
          ok: false,
          error: "Ese artículo no tiene precio de lista para aplicarle el descuento del cliente; solo se puede pedir a precio de mostrador",
          status: 400,
        }
      : { ok: false, error: "No hay un artículo con ese código o no tiene precio", status: 404 };
  }
  return {
    ok: true,
    partida: {
      origen: captura.origen,
      codigo: articulo.codigo,
      idPiezaUsada: null,
      descripcion: articulo.descripcion,
      cantidad: captura.cantidad,
      precioUnitario: articulo.precioConIva,
      existenciaAlPedir: articulo.existencia,
    },
  };
}

export async function POST(request: Request) {
  const guardia = await exigirMostrador(request);
  if (!guardia.ok) return guardia.respuesta;
  const { sesion } = guardia;

  const lectura = await leerCuerpo(request);
  if (!lectura.ok) return lectura.respuesta;
  const validacion = validarCapturaPartida(lectura.cuerpo);
  if (!validacion.ok) return respuestaError(validacion.error, 400);

  try {
    const borrador = await obtenerBorrador(actorDe(sesion));
    if (!borrador) return respuestaError(ERROR_SIN_BORRADOR, 404);

    const cotizacion = await cotizar(validacion.datos, borrador);
    if (!cotizacion.ok) return respuestaError(cotizacion.error, cotizacion.status);

    const pedido = await agregarPartida(borrador.id, cotizacion.partida, sesion.usuario, CANAL_MOSTRADOR);
    return respuestaOk({ pedido });
  } catch (error) {
    return respuestaDeError(error, "agregando una partida al borrador");
  }
}
