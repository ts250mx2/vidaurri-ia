import { exigirKiosco } from "@/lib/auth-kiosco";
import { cambiarSucursal, enviarPedido, fijarClienteBorrador, obtenerBorrador } from "@/lib/db-pedidos";
import {
  AREA_KIOSCO,
  CANAL_KIOSCO,
  ERROR_CUPO_ENVIOS,
  ERROR_SIN_PEDIDO_KIOSCO,
  LIMITE_ENVIOS_KIOSCO,
  USUARIO_KIOSCO,
  acuseParaKiosco,
  actorCapturaKiosco,
  crearCupo,
} from "@/lib/kiosco-api";
import { leerCuerpo, respuestaDeError, respuestaError, respuestaOk } from "@/lib/mostrador-api";
import { validarDatosClienteKiosco } from "@/lib/pedidos";

// El cliente toca "Enviar pedido" y teclea su nombre y su celular: el pedido
// recibe folio y entra a la cola del mostrador con canal 'kiosco'. NO toca el
// POS (la cotización y la back order siguen naciendo cuando el mostrador lo
// confirma) y la respuesta es solo el acuse —folio, piezas y total—: la
// pantalla del acuse no tiene por qué saber nada más, y menos con el aparato
// suelto en el piso.

export const dynamic = "force-dynamic";

/** Tope por aparato (20 por hora): un cliente honesto manda uno. */
const cupo = crearCupo(LIMITE_ENVIOS_KIOSCO);

export async function POST(request: Request) {
  const guardia = await exigirKiosco(request);
  if (!guardia.ok) return guardia.respuesta;
  const { kiosco } = guardia;

  const lectura = await leerCuerpo(request);
  if (!lectura.ok) return lectura.respuesta;
  const validacion = validarDatosClienteKiosco(lectura.cuerpo);
  if (!validacion.ok) return respuestaError(validacion.error, 400);
  const { nombre, telefono } = validacion.datos;

  if (!cupo.intentar(kiosco.kiosco)) return respuestaError(ERROR_CUPO_ENVIOS, 429);

  try {
    const borrador = await obtenerBorrador(actorCapturaKiosco(kiosco));
    if (!borrador) return respuestaError(ERROR_SIN_PEDIDO_KIOSCO, 404);

    // El aparato manda sobre la sucursal: si lo reconfiguraron con el pedido
    // abierto, se recoge donde está la pantalla, no donde nació el borrador.
    if (borrador.sucursal !== kiosco.sucursal) {
      await cambiarSucursal(borrador.id, kiosco.sucursal, USUARIO_KIOSCO, CANAL_KIOSCO);
    }
    await fijarClienteBorrador(borrador.id, { cliente: nombre, telefono }, USUARIO_KIOSCO, CANAL_KIOSCO);
    const pedido = await enviarPedido(borrador.id, USUARIO_KIOSCO, CANAL_KIOSCO, null);

    return respuestaOk({ ...acuseParaKiosco(pedido) });
  } catch (error) {
    return respuestaDeError(error, "enviando el pedido del kiosco", AREA_KIOSCO);
  }
}
