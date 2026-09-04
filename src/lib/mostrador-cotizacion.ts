import { articuloParaPedido, motivoSinArticulo, piezaUsadaParaPedido } from "@/lib/articulos-pedido";
import { obtenerClienteDescuento } from "@/lib/db-clientes-descuento";
import type { PartidaNueva } from "@/lib/db-pedidos";
import { errorCantidadUsada, type CapturaPartida, type PedidoDetalle } from "@/lib/pedidos";

// Cotización de un renglón que la pantalla del mostrador agrega a un pedido,
// sea el borrador del vendedor (POST /borrador/partidas) o un pedido que ya
// salió de captura (POST /pedidos/[id]/partidas). El precio NUNCA viene del
// cliente HTTP: se resuelve aquí con el descuento ACTUAL del padrón del
// cliente del pedido (la misma fuente que usa Vico en /api/mostrador/vico),
// así el pedido canta lo mismo por los dos caminos.

export type Cotizacion =
  | { ok: true; partida: PartidaNueva }
  | { ok: false; error: string; status: 400 | 404 };

/** Lo que la cotización necesita del pedido: de quién es y con qué descuento nació. */
export type PedidoACotizar = Pick<PedidoDetalle, "idCliente" | "descuentoPct">;

/**
 * Descuento con el que se cotiza: el del padrón hoy (no el snapshot del
 * pedido, que pudo quedarse atrás si el panel lo cambió con la captura
 * abierta), o mostrador (null) para público general. Si el cliente ya no está
 * en el padrón se cae al snapshot: es lo último que se supo de él.
 */
export async function descuentoDelPedido(pedido: PedidoACotizar): Promise<number | null> {
  if (pedido.idCliente === null) return null;
  const cliente = await obtenerClienteDescuento(pedido.idCliente);
  return cliente?.descuento ?? pedido.descuentoPct;
}

export async function cotizarPartida(captura: CapturaPartida, pedido: PedidoACotizar): Promise<Cotizacion> {
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

  const descuento = await descuentoDelPedido(pedido);
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
