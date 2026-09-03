import { exigirMostrador } from "@/lib/auth-mostrador";
import { obtenerClienteDescuento } from "@/lib/db-clientes-descuento";
import { cancelarBorrador, crearBorrador, obtenerBorrador, type DatosBorrador } from "@/lib/db-pedidos";
import {
  CANAL_MOSTRADOR,
  actorDe,
  leerCuerpo,
  respuestaDeError,
  respuestaError,
  respuestaOk,
} from "@/lib/mostrador-api";
import { validarAperturaBorrador, type PedidoDetalle } from "@/lib/pedidos";

// El borrador del vendedor: la captura en curso de /mostrador/nuevo. Cada
// vendedor tiene a lo más uno (clave v:<usuario>); abrirlo para otro cliente
// tira el anterior, porque sus precios llevan el descuento de aquel cliente.

export const dynamic = "force-dynamic";

const CLIENTE_PUBLICO = "Público general";
const SUCURSAL_CASA = "matriz";

export async function GET(request: Request) {
  const guardia = await exigirMostrador(request);
  if (!guardia.ok) return guardia.respuesta;

  try {
    const pedido = await obtenerBorrador(actorDe(guardia.sesion));
    return respuestaOk({ pedido });
  } catch (error) {
    return respuestaDeError(error, "leyendo el borrador del vendedor");
  }
}

/** Cabecera del borrador nuevo: snapshot del cliente del padrón, o público general. */
async function datosDelCliente(
  idCliente: number | null
): Promise<{ ok: true; datos: Omit<DatosBorrador, "sucursal"> } | { ok: false; error: string }> {
  if (idCliente === null) {
    return {
      ok: true,
      datos: { canal: CANAL_MOSTRADOR, idCliente: null, cliente: CLIENTE_PUBLICO, telefono: null, descuentoPct: 0 },
    };
  }
  const cliente = await obtenerClienteDescuento(idCliente);
  if (!cliente) return { ok: false, error: "El cliente no está en el padrón" };
  return {
    ok: true,
    datos: {
      canal: CANAL_MOSTRADOR,
      idCliente: cliente.id,
      cliente: cliente.cliente,
      telefono: cliente.telefono,
      descuentoPct: cliente.descuento,
    },
  };
}

/** Un borrador con partidas para OTRO cliente no se tira sin avisar (409). */
function estorba(previo: PedidoDetalle, idCliente: number | null): boolean {
  return previo.partidas.length > 0 && previo.idCliente !== idCliente;
}

export async function POST(request: Request) {
  const guardia = await exigirMostrador(request);
  if (!guardia.ok) return guardia.respuesta;
  const actor = actorDe(guardia.sesion);

  const lectura = await leerCuerpo(request);
  if (!lectura.ok) return lectura.respuesta;
  const validacion = validarAperturaBorrador(lectura.cuerpo);
  if (!validacion.ok) return respuestaError(validacion.error, 400);
  const { idCliente, sucursal } = validacion.datos;

  try {
    const previo = await obtenerBorrador(actor);
    if (previo && estorba(previo, idCliente)) {
      return respuestaError(
        `Ya tienes un borrador con partidas para ${previo.cliente}; envíalo o descártalo antes de cambiar de cliente`,
        409,
        { pedido: previo }
      );
    }
    const cliente = await datosDelCliente(idCliente);
    if (!cliente.ok) return respuestaError(cliente.error, 404);

    const pedido = await crearBorrador(actor, {
      ...cliente.datos,
      // Si no dicen sucursal se conserva la del borrador que se reutiliza; si
      // no había, la de la casa.
      sucursal: sucursal ?? previo?.sucursal ?? SUCURSAL_CASA,
    });
    return respuestaOk({ pedido });
  } catch (error) {
    return respuestaDeError(error, "abriendo el borrador del vendedor");
  }
}

export async function DELETE(request: Request) {
  const guardia = await exigirMostrador(request);
  if (!guardia.ok) return guardia.respuesta;

  try {
    // Idempotente: si no había borrador el resultado es el mismo, no hay captura viva.
    await cancelarBorrador(actorDe(guardia.sesion), CANAL_MOSTRADOR);
    return respuestaOk();
  } catch (error) {
    return respuestaDeError(error, "descartando el borrador del vendedor");
  }
}
