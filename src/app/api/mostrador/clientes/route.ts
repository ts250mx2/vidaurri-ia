import { exigirMostrador } from "@/lib/auth-mostrador";
import { validarCapturaClienteDescuento } from "@/lib/clientes-descuento";
import { crearClienteDescuento, listarClientesDescuento } from "@/lib/db-clientes-descuento";
import { descuentoPorDefecto } from "@/lib/descuento-default";
import { leerCuerpo, respuestaDeError, respuestaError, respuestaOk } from "@/lib/mostrador-api";
import { puedeFijarDescuento } from "@/lib/pedidos";

// Padrón de clientes con descuento visto desde el mostrador: buscador para
// elegir a quién se le levanta el pedido, y alta rápida (nombre + celular)
// cuando el cliente no está. El alta de aquí NO manda la bienvenida por
// WhatsApp ni permite pedir por su cuenta: eso lo decide el panel después.
// El descuento solo lo fija un supervisor (Operaciones / Administrador);
// Ventas siempre da de alta con el descuento por defecto, porque fijar el
// descuento es fijar el precio del pedido.

export const dynamic = "force-dynamic";

const LIMITE_CLIENTES = 20;
const BUSQUEDA_MAX = 80;

export async function GET(request: Request) {
  const guardia = await exigirMostrador(request);
  if (!guardia.ok) return guardia.respuesta;

  const { searchParams } = new URL(request.url);
  const busqueda = (searchParams.get("busqueda") ?? "").trim().slice(0, BUSQUEDA_MAX);

  try {
    const pagina = await listarClientesDescuento({ busqueda, pagina: 1, porPagina: LIMITE_CLIENTES });
    return respuestaOk({ clientes: pagina.registros });
  } catch (error) {
    return respuestaDeError(error, "buscando en el padrón de clientes");
  }
}

/** Lo que manda el mostrador, con los valores que el alta rápida no captura.
 *  El descuento recibido solo se respeta si el perfil puede fijarlo. */
function conValoresDeAltaRapida(cuerpo: unknown, aceptaDescuento: boolean): Record<string, unknown> {
  const base = cuerpo && typeof cuerpo === "object" && !Array.isArray(cuerpo) ? (cuerpo as Record<string, unknown>) : {};
  const sinDescuento = base.descuento == null || base.descuento === "";
  return {
    ...base,
    descuento: aceptaDescuento && !sinDescuento ? base.descuento : descuentoPorDefecto(),
    permitirPedido: false,
  };
}

export async function POST(request: Request) {
  const guardia = await exigirMostrador(request);
  if (!guardia.ok) return guardia.respuesta;

  const lectura = await leerCuerpo(request);
  if (!lectura.ok) return lectura.respuesta;
  const validacion = validarCapturaClienteDescuento(
    conValoresDeAltaRapida(lectura.cuerpo, puedeFijarDescuento(guardia.sesion.perfil))
  );
  if (!validacion.ok) return respuestaError(validacion.error, 400);

  try {
    const cliente = await crearClienteDescuento(validacion.datos, guardia.sesion.usuario);
    return respuestaOk({ cliente }, 201);
  } catch (error) {
    return respuestaDeError(error, "dando de alta un cliente desde el mostrador");
  }
}
