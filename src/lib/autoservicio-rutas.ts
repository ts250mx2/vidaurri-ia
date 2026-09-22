import type { NextResponse } from "next/server";
import { buscarArticulosParaPedido, LIMITE_BUSQUEDA_ARTICULOS } from "@/lib/articulos-pedido";
import { exigirCliente } from "@/lib/auth-clientes";
import { exigirKiosco, respuestaNoAutorizadoKiosco } from "@/lib/auth-kiosco";
import {
  actorCapturaDe,
  areaDe,
  canalDe,
  claveCupoDe,
  clienteDe,
  datosBorradorDe,
  datosEnvioDe,
  descuentoDe,
  errorCupoEnviosDe,
  errorParaEnviar,
  usuarioDe,
  type Ambito,
} from "@/lib/autoservicio";
import { crearManejadorVico } from "@/lib/autoservicio-vico";
import type { ClienteDescuento } from "@/lib/clientes-descuento";
import {
  agregarPartida,
  cambiarCantidadPartida,
  cambiarSucursal,
  cancelarBorrador,
  crearBorrador,
  enviarPedido,
  fijarClienteBorrador,
  obtenerBorrador,
  pedidoDeClientePorFolio,
  pedidosDeCliente,
  quitarPartida,
} from "@/lib/db-pedidos";
import {
  ERROR_SIN_PEDIDO_KIOSCO,
  LIMITE_ENVIOS_KIOSCO,
  acuseParaKiosco,
  articuloParaKiosco,
  crearCupo,
  pedidoParaKiosco,
} from "@/lib/kiosco-api";
import {
  ERROR_PEDIDO_CLIENTE_NO_ENCONTRADO,
  ERROR_PEDIDO_DE_OTRO_CLIENTE,
  PEDIDOS_CLIENTE_KIOSCO,
  detalleParaCliente,
  esBorradorDelCliente,
  pedidoParaCliente,
} from "@/lib/kiosco-cliente";
import { idDeRuta, leerCuerpo, respuestaDeError, respuestaError, respuestaOk } from "@/lib/mostrador-api";
import { cotizarPartida } from "@/lib/mostrador-cotizacion";
import { leerFolioRuta, validarCantidad, validarCapturaPartida } from "@/lib/pedidos";

// El trabajo de las rutas del autoservicio, implementado UNA vez y montado en
// dos familias: /api/kiosco/* (el aparato del piso) y /api/clientes/* (el
// cliente del padrón en su dispositivo). Cada archivo de ruta solo exporta el
// manejador que le toca (`export const GET = rutasKiosco.articulos`). Lo que
// cambia entre familias sale del ámbito (autoservicio.ts): clave del
// borrador, canal, sucursal, precios, quién puede enviar y los topes.
//
// Todo lo que sale va proyectado (kiosco-api.ts / kiosco-cliente.ts): nunca
// ids internos, bitácora, datos del POS, costos ni existencias exactas. El
// kiosco lo lee quien se pare enfrente y el cliente solo debe ver lo suyo.

const BUSQUEDA_MAX = 80;

/** `limite` del querystring: un entero positivo, o el default si no viene o no se entiende; la librería lo acota. */
function limiteDe(crudo: string | null): number {
  const n = Number.parseInt(crudo ?? "", 10);
  return Number.isInteger(n) && n > 0 ? n : LIMITE_BUSQUEDA_ARTICULOS;
}
const MOTIVO_DESCARTE = "Pedido descartado por el cliente";

export type ResultadoAmbito = { ok: true; ambito: Ambito } | { ok: false; respuesta: NextResponse };
export type ResolverAmbito = (request: Request) => Promise<ResultadoAmbito>;

type Manejador = (request: Request) => Promise<NextResponse>;
type ManejadorCon<P> = (request: Request, contexto: { params: Promise<P> }) => Promise<NextResponse>;

export interface RutasAutoservicio {
  /** GET articulos?busqueda= */
  articulos: Manejador;
  /** GET borrador */
  leerBorrador: Manejador;
  /** DELETE borrador */
  limpiarBorrador: Manejador;
  /** POST borrador/partidas */
  agregarPieza: Manejador;
  /** PATCH borrador/partidas/[idPartida] */
  cambiarCantidad: ManejadorCon<{ idPartida: string }>;
  /** DELETE borrador/partidas/[idPartida] */
  quitarPieza: ManejadorCon<{ idPartida: string }>;
  /** POST borrador/enviar */
  enviar: Manejador;
  /** POST vico */
  vico: Manejador;
  /** GET pedidos (del cliente) */
  pedidos: Manejador;
  /** GET pedidos/[folio] (del cliente) */
  pedido: ManejadorCon<{ folio: string }>;
}

// ---------------------------------------------------------------------------
// Resolución del ámbito por familia.
// ---------------------------------------------------------------------------

/** /api/kiosco/*: la API key y la cabecera del aparato, más el cliente que
 *  entró en ese aparato si lo hay. */
export async function ambitoKiosco(request: Request): Promise<ResultadoAmbito> {
  const guardia = await exigirKiosco(request);
  if (!guardia.ok) return guardia;
  return { ok: true, ambito: { tipo: "kiosco", sesion: guardia.kiosco, cliente: guardia.cliente } };
}

/** /api/clientes/*: la API key y X-Cliente, revalidado en el padrón. */
export async function ambitoCliente(request: Request): Promise<ResultadoAmbito> {
  const guardia = await exigirCliente(request);
  if (!guardia.ok) return guardia;
  return { ok: true, ambito: { tipo: "cliente", cliente: guardia.cliente } };
}

/** Las rutas del cliente ("Mis pedidos") exigen que haya cliente: en el
 *  kiosco, que haya entrado con su celular (401 con código cliente, la
 *  página lo manda a entrar); en el área siempre lo hay. */
function clienteRequerido(ambito: Ambito): { ok: true; cliente: ClienteDescuento } | { ok: false; respuesta: NextResponse } {
  const cliente = clienteDe(ambito);
  if (cliente) return { ok: true, cliente };
  return { ok: false, respuesta: respuestaNoAutorizadoKiosco("cliente") };
}

// ---------------------------------------------------------------------------
// La fábrica.
// ---------------------------------------------------------------------------

export function rutasAutoservicio(resolver: ResolverAmbito): RutasAutoservicio {
  /** Tope de envíos (20 por hora): un cliente honesto manda uno. */
  const cupoEnvios = crearCupo(LIMITE_ENVIOS_KIOSCO);

  const articulos: Manejador = async (request) => {
    const guardia = await resolver(request);
    if (!guardia.ok) return guardia.respuesta;
    const { ambito } = guardia;

    const { searchParams } = new URL(request.url);
    const busqueda = (searchParams.get("busqueda") ?? "").trim().slice(0, BUSQUEDA_MAX);
    if (!busqueda) return respuestaOk({ articulos: [] });

    try {
      // Precio de MOSTRADOR (descuento null) o el del cliente del padrón.
      const encontrados = await buscarArticulosParaPedido(
        busqueda,
        descuentoDe(ambito),
        limiteDe(searchParams.get("limite"))
      );
      return respuestaOk({ articulos: encontrados.map(articuloParaKiosco) });
    } catch (error) {
      return respuestaDeError(error, `buscando artículos ("${busqueda}")`, areaDe(ambito));
    }
  };

  const leerBorrador: Manejador = async (request) => {
    const guardia = await resolver(request);
    if (!guardia.ok) return guardia.respuesta;
    const { ambito } = guardia;

    try {
      const borrador = await obtenerBorrador(actorCapturaDe(ambito));
      return respuestaOk({ pedido: pedidoParaKiosco(borrador) });
    } catch (error) {
      return respuestaDeError(error, "leyendo el pedido en curso", areaDe(ambito));
    }
  };

  const limpiarBorrador: Manejador = async (request) => {
    const guardia = await resolver(request);
    if (!guardia.ok) return guardia.respuesta;
    const { ambito } = guardia;

    try {
      // Idempotente: si no había pedido en curso el resultado es el mismo.
      await cancelarBorrador(actorCapturaDe(ambito), canalDe(ambito), MOTIVO_DESCARTE);
      return respuestaOk({ pedido: null });
    } catch (error) {
      return respuestaDeError(error, "limpiando el pedido en curso", areaDe(ambito));
    }
  };

  const agregarPieza: Manejador = async (request) => {
    const guardia = await resolver(request);
    if (!guardia.ok) return guardia.respuesta;
    const { ambito } = guardia;
    const actor = actorCapturaDe(ambito);

    const lectura = await leerCuerpo(request);
    if (!lectura.ok) return lectura.respuesta;
    const validacion = validarCapturaPartida(lectura.cuerpo);
    if (!validacion.ok) return respuestaError(validacion.error, 400);

    try {
      // El borrador vivo se reutiliza TAL CUAL solo si es de quien está en la
      // pantalla (anónimo sin sesión, o el cliente). Nunca por crearBorrador a
      // secas: si el kiosco ya le puso nombre al pedido (la pantalla de datos)
      // y el cliente regresa a agregar otra pieza, abrir el borrador "para
      // público general" cancelaría el suyo con todo lo capturado. Si el que
      // quedó es de otro, crearBorrador lo cancela y abre el de este cliente.
      // El precio lo resuelve cotizarPartida con el descuento del BORRADOR.
      const previo = await obtenerBorrador(actor);
      const borrador =
        previo && esBorradorDelCliente(previo, clienteDe(ambito)) ? previo : await crearBorrador(actor, datosBorradorDe(ambito));

      const cotizacion = await cotizarPartida(validacion.datos, borrador);
      if (!cotizacion.ok) return respuestaError(cotizacion.error, cotizacion.status);

      const pedido = await agregarPartida(borrador.id, cotizacion.partida, usuarioDe(ambito), canalDe(ambito));
      return respuestaOk({ pedido: pedidoParaKiosco(pedido) });
    } catch (error) {
      return respuestaDeError(error, "agregando una pieza al pedido", areaDe(ambito));
    }
  };

  const cambiarCantidad: ManejadorCon<{ idPartida: string }> = async (request, contexto) => {
    const guardia = await resolver(request);
    if (!guardia.ok) return guardia.respuesta;
    const { ambito } = guardia;

    const idPartida = await idDeRuta(contexto.params, "idPartida");
    if (idPartida === null) return respuestaError("Identificador inválido", 400);

    const lectura = await leerCuerpo(request);
    if (!lectura.ok) return lectura.respuesta;
    const validacion = validarCantidad(lectura.cuerpo);
    if (!validacion.ok) return respuestaError(validacion.error, 400);

    try {
      // La partida tiene que ser del borrador de ESTE ámbito: un id de otro
      // pedido se reporta como inexistente.
      const borrador = await obtenerBorrador(actorCapturaDe(ambito));
      if (!borrador) return respuestaError(ERROR_SIN_PEDIDO_KIOSCO, 404);

      const pedido = await cambiarCantidadPartida(
        borrador.id,
        idPartida,
        validacion.datos.cantidad,
        usuarioDe(ambito),
        canalDe(ambito)
      );
      return respuestaOk({ pedido: pedidoParaKiosco(pedido) });
    } catch (error) {
      return respuestaDeError(error, `cambiando la cantidad de la partida ${idPartida}`, areaDe(ambito));
    }
  };

  const quitarPieza: ManejadorCon<{ idPartida: string }> = async (request, contexto) => {
    const guardia = await resolver(request);
    if (!guardia.ok) return guardia.respuesta;
    const { ambito } = guardia;

    const idPartida = await idDeRuta(contexto.params, "idPartida");
    if (idPartida === null) return respuestaError("Identificador inválido", 400);

    try {
      const borrador = await obtenerBorrador(actorCapturaDe(ambito));
      if (!borrador) return respuestaError(ERROR_SIN_PEDIDO_KIOSCO, 404);

      const pedido = await quitarPartida(borrador.id, idPartida, usuarioDe(ambito), canalDe(ambito));
      return respuestaOk({ pedido: pedidoParaKiosco(pedido) });
    } catch (error) {
      return respuestaDeError(error, `quitando la partida ${idPartida}`, areaDe(ambito));
    }
  };

  // "Enviar pedido": el pedido recibe folio y entra a la cola del mostrador.
  // NO toca el POS (la cotización y la back order nacen cuando el mostrador
  // confirma) y responde solo el acuse: folio, piezas y total.
  const enviar: Manejador = async (request) => {
    const guardia = await resolver(request);
    if (!guardia.ok) return guardia.respuesta;
    const { ambito } = guardia;

    // El pedido remoto sigue gateado por permitir_pedido, como por WhatsApp.
    const sinPermiso = errorParaEnviar(ambito);
    if (sinPermiso) return respuestaError(sinPermiso, 403);

    const lectura = await leerCuerpo(request);
    if (!lectura.ok) return lectura.respuesta;
    const envio = datosEnvioDe(ambito, lectura.cuerpo);
    if (!envio.ok) return respuestaError(envio.error, 400);

    if (!cupoEnvios.intentar(claveCupoDe(ambito))) return respuestaError(errorCupoEnviosDe(ambito), 429);

    const usuario = usuarioDe(ambito);
    const canal = canalDe(ambito);
    try {
      const borrador = await obtenerBorrador(actorCapturaDe(ambito));
      if (!borrador) return respuestaError(ERROR_SIN_PEDIDO_KIOSCO, 404);
      // Un borrador que no nació con este cliente lleva precios que no son los
      // suyos (o es de otro): no se manda a su nombre.
      if (!esBorradorDelCliente(borrador, clienteDe(ambito))) return respuestaError(ERROR_PEDIDO_DE_OTRO_CLIENTE, 409);

      // La sucursal del envío manda sobre la del borrador: la del aparato en el
      // kiosco (si lo reconfiguraron con el pedido abierto, se recoge donde
      // está la pantalla) o la que eligió el cliente.
      if (borrador.sucursal !== envio.datos.sucursal) {
        await cambiarSucursal(borrador.id, envio.datos.sucursal, usuario, canal);
      }
      if (envio.datos.cliente) await fijarClienteBorrador(borrador.id, envio.datos.cliente, usuario, canal);
      const pedido = await enviarPedido(borrador.id, usuario, canal, envio.datos.observaciones, envio.datos.domicilio);

      return respuestaOk({ ...acuseParaKiosco(pedido) });
    } catch (error) {
      return respuestaDeError(error, "enviando el pedido", areaDe(ambito));
    }
  };

  // "Mis pedidos": los últimos pedidos ya enviados del cliente. El filtro es
  // el id del cliente del GUARDIA (revalidado en el padrón), nunca nada que
  // mande la pantalla.
  const pedidos: Manejador = async (request) => {
    const guardia = await resolver(request);
    if (!guardia.ok) return guardia.respuesta;
    const { ambito } = guardia;
    const cliente = clienteRequerido(ambito);
    if (!cliente.ok) return cliente.respuesta;

    try {
      const lista = await pedidosDeCliente(cliente.cliente.id, PEDIDOS_CLIENTE_KIOSCO);
      return respuestaOk({ pedidos: lista.map(pedidoParaCliente) });
    } catch (error) {
      return respuestaDeError(error, "leyendo los pedidos del cliente", areaDe(ambito));
    }
  };

  // El detalle de UN pedido del cliente. Folio y cliente se buscan juntos:
  // un folio de otro cliente, uno que no existe y uno malformado responden el
  // mismo 404, así no se puede saber si un folio ajeno existe.
  const pedido: ManejadorCon<{ folio: string }> = async (request, contexto) => {
    const guardia = await resolver(request);
    if (!guardia.ok) return guardia.respuesta;
    const { ambito } = guardia;
    const cliente = clienteRequerido(ambito);
    if (!cliente.ok) return cliente.respuesta;

    const folio = leerFolioRuta((await contexto.params).folio ?? "");
    if (folio === null) return respuestaError(ERROR_PEDIDO_CLIENTE_NO_ENCONTRADO, 404);

    try {
      const detalle = await pedidoDeClientePorFolio(cliente.cliente.id, folio);
      if (!detalle) return respuestaError(ERROR_PEDIDO_CLIENTE_NO_ENCONTRADO, 404);
      return respuestaOk({ pedido: detalleParaCliente(detalle) });
    } catch (error) {
      return respuestaDeError(error, `leyendo el pedido ${folio} del cliente`, areaDe(ambito));
    }
  };

  return {
    articulos,
    leerBorrador,
    limpiarBorrador,
    agregarPieza,
    cambiarCantidad,
    quitarPieza,
    enviar,
    vico: crearManejadorVico(resolver),
    pedidos,
    pedido,
  };
}

/** Las dos familias, instanciadas una sola vez (los cupos y la memoria de
 *  Vico viven en cada instancia; sus claves no se cruzan: k:… vs c:…). */
export const rutasKiosco = rutasAutoservicio(ambitoKiosco);
export const rutasClientes = rutasAutoservicio(ambitoCliente);
