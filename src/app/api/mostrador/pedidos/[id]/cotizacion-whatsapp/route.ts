import { exigirMostrador } from "@/lib/auth-mostrador";
import { enviarTextoWhatsapp, textoCotizacionWhatsapp, tituloCotizacion } from "@/lib/cotizacion-whatsapp";
import { actualizarDomicilio, actualizarObservaciones, obtenerPedido } from "@/lib/db-pedidos";
import {
  CANAL_MOSTRADOR,
  idDeRuta,
  leerCuerpo,
  respuestaDeError,
  respuestaError,
  respuestaOk,
} from "@/lib/mostrador-api";
import { urlCotizacionPagina, urlPdfCotizacion } from "@/lib/pedido-enlace";
import { puedeEditarPedido, validarDomicilio, validarObservaciones, type PedidoDetalle } from "@/lib/pedidos";
import { baseUrlConfigurada, paginaUrlConfigurada } from "@/lib/url-publica";

// POST /api/mostrador/pedidos/[id]/cotizacion-whatsapp: la cotización del
// pedido (borrador incluido) al celular registrado del cliente, por WhatsApp
// (Axon Logic). Cuerpo `{ observaciones?, domicilio?, telefono? }`: lo que la
// pantalla tiene tecleado y todavía no ha guardado; observaciones y domicilio
// se guardan en el borrador antes de cotizar, para que el PDF los traiga y no
// se pierdan al enviar. `telefono` (10 dígitos) es a dónde mandarla cuando el
// vendedor tecleó o dejó en el campo (arranca con el del padrón); NO se guarda
// en el pedido ni en el padrón. Sin él, va al celular registrado. Responde `{ ok, telefono, url }`; 400 sin celular por ninguno de los
// dos lados, 502 si la pasarela no aceptó el mensaje, con el motivo legible.

export const dynamic = "force-dynamic";

type Contexto = { params: Promise<{ id: string }> };

const ERROR_SIN_CELULAR = "El pedido no tiene celular registrado: teclea uno de 10 dígitos o elige al cliente del padrón";
const ERROR_CELULAR = "El celular para la cotización son 10 dígitos";

/** `telefono` del cuerpo: null si no viene; undefined si viene pero no son 10 dígitos. */
function leerTelefono(crudo: unknown): string | null | undefined {
  if (crudo == null || crudo === "") return null;
  if (typeof crudo !== "string") return undefined;
  const digitos = crudo.replace(/\D/g, "");
  return digitos.length === 10 ? digitos : undefined;
}
const ERROR_SIN_ENLACE = "Falta PUBLIC_BASE_URL o JWT_SECRET en el servidor: no se puede armar la liga al PDF";

function esObjeto(entrada: unknown): entrada is Record<string, unknown> {
  return !!entrada && typeof entrada === "object" && !Array.isArray(entrada);
}

export async function POST(request: Request, contexto: Contexto) {
  const guardia = await exigirMostrador(request);
  if (!guardia.ok) return guardia.respuesta;
  const { sesion } = guardia;

  const id = await idDeRuta(contexto.params, "id");
  if (id === null) return respuestaError("Identificador inválido", 400);

  const lectura = await leerCuerpo(request);
  if (!lectura.ok) return lectura.respuesta;
  const cuerpo = esObjeto(lectura.cuerpo) ? lectura.cuerpo : {};
  const observaciones = validarObservaciones(cuerpo);
  if (!observaciones.ok) return respuestaError(observaciones.error, 400);
  const domicilio = validarDomicilio(cuerpo.domicilio);
  if (!domicilio.ok) return respuestaError(domicilio.error, 400);
  const telefonoTecleado = leerTelefono(cuerpo.telefono);
  if (telefonoTecleado === undefined) return respuestaError(ERROR_CELULAR, 400);

  try {
    let pedido: PedidoDetalle | null = await obtenerPedido(id);
    if (!pedido) return respuestaError("El pedido no existe", 404);
    // La pantalla manda el celular que se ve en el campo (arranca con el del
    // padrón y el vendedor lo puede cambiar); sin campo, el registrado.
    const telefono = telefonoTecleado ?? pedido.telefono;
    if (!telefono) return respuestaError(ERROR_SIN_CELULAR, 400);

    // Lo tecleado en la pantalla se guarda antes de cotizar (solo si el
    // pedido sigue editable; uno ya surtido se cotiza tal cual está).
    if (puedeEditarPedido(pedido.estatus)) {
      if ("observaciones" in cuerpo && pedido.observaciones !== observaciones.datos.observaciones) {
        pedido = await actualizarObservaciones(id, observaciones.datos.observaciones, sesion.usuario, CANAL_MOSTRADOR);
      }
      if ("domicilio" in cuerpo && JSON.stringify(pedido.domicilio) !== JSON.stringify(domicilio.datos)) {
        pedido = await actualizarDomicilio(id, domicilio.datos, sesion.usuario, CANAL_MOSTRADOR);
      }
    }

    // Con PAGINA_URL la liga va a la página pública, donde el cliente la firma
    // y se vuelve pedido; sin ella, al PDF de aquí.
    const enPagina = urlCotizacionPagina(paginaUrlConfigurada(), id);
    const url = enPagina ?? urlPdfCotizacion(baseUrlConfigurada(), id);
    if (!url) {
      console.error("[mostrador] cotización por WhatsApp sin liga:", ERROR_SIN_ENLACE);
      return respuestaError(ERROR_SIN_ENLACE, 500);
    }

    const envio = await enviarTextoWhatsapp(
      telefono,
      textoCotizacionWhatsapp(pedido, url, enPagina !== null),
      `${tituloCotizacion(pedido)} por WhatsApp al ${telefono} (${sesion.usuario})`
    );
    if (!envio.ok) return respuestaError(`No se pudo mandar la cotización: ${envio.motivo}`, 502);
    return respuestaOk({ telefono, url, pedido });
  } catch (error) {
    return respuestaDeError(error, `mandando la cotización del pedido ${id} por WhatsApp`);
  }
}
