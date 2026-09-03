import type Anthropic from "@anthropic-ai/sdk";
import type { UsoHerramienta } from "@/lib/agente-modelo";
import { articuloParaPedido, motivoSinArticulo, piezaUsadaParaPedido } from "@/lib/articulos-pedido";
import { limpiarTexto } from "@/lib/clientes-descuento";
import { listarClientesDescuento } from "@/lib/db-clientes-descuento";
import {
  LimitePedidoError,
  PartidaNoEncontradaError,
  PedidoNoEditableError,
  PedidoNoEncontradoError,
  PedidoVacioError,
  TransicionInvalidaError,
  agregarPartida,
  cambiarSucursal,
  cancelarBorrador,
  crearBorrador,
  enviarPedido,
  obtenerBorrador,
  obtenerPedido,
  quitarPartida,
  ultimosPedidosDeTelefono,
  type ActorCaptura,
  type DatosBorrador,
  type PartidaNueva,
} from "@/lib/db-pedidos";
import {
  BUSQUEDA_MAX,
  MOTIVO_MAX,
  OBSERVACIONES_MAX,
  SUCURSALES_ENTREGA,
  errorCantidadUsada,
  esSucursal,
  validarCapturaPartida,
  type CanalPedido,
  type PartidaPedido,
  type PedidoDetalle,
  type PerfilPos,
  type SucursalEntrega,
} from "@/lib/pedidos";

// Herramientas de PEDIDO de Vico (fase 1: mostrador + WhatsApp). Viven aparte
// de vendedor.ts porque solo entran al arreglo de herramientas cuando el actor
// puede pedir; para el anónimo y el cliente sin permiso el agente sigue siendo
// exactamente el de siempre.
//
// Quién habla con Vico se modela como ActorVendedor. De él salen tres cosas
// que las tools nunca toman del modelo: el actor de captura (dueño del
// borrador), el descuento con el que se cotiza cada partida y el canal con el
// que se firma la bitácora. Así el precio del pedido no depende de lo que el
// modelo crea que eligió, y un cliente solo puede tocar su propio borrador.

export type ActorVendedor =
  | { tipo: "anonimo" }
  | {
      tipo: "cliente";
      idCliente: number;
      nombre: string;
      /** Celular nacional de 10 dígitos: la llave de su borrador (c:<telefono>). */
      telefono: string;
      descuento: number;
      permitirPedido: boolean;
    }
  | {
      tipo: "vendedor";
      usuario: string;
      nombre: string;
      perfil: PerfilPos;
      /** Cliente del padrón que atiende; null = público general. */
      idCliente: number | null;
      clienteNombre: string | null;
      clienteTelefono: string | null;
      /** Descuento del cliente atendido; null = precio de mostrador. */
      descuento: number | null;
    };

/** Actor que sí puede levantar pedidos (lo que despachan las tools). */
type ActorConPedido = Exclude<ActorVendedor, { tipo: "anonimo" }>;

/** El vendedor siempre; el cliente solo si el padrón lo autoriza; el anónimo nunca. */
export function puedePedir(actor: ActorVendedor | undefined): actor is ActorConPedido {
  if (!actor) return false;
  if (actor.tipo === "vendedor") return true;
  if (actor.tipo === "cliente") return actor.permitirPedido;
  return false;
}

export const NOMBRES_HERRAMIENTAS_PEDIDO = [
  "seleccionar_cliente",
  "agregar_al_pedido",
  "ver_pedido",
  "quitar_del_pedido",
  "cambiar_sucursal",
  "confirmar_pedido",
  "cancelar_pedido",
] as const;

export type NombreHerramientaPedido = (typeof NOMBRES_HERRAMIENTAS_PEDIDO)[number];

export function esHerramientaPedido(nombre: string): nombre is NombreHerramientaPedido {
  return (NOMBRES_HERRAMIENTAS_PEDIDO as ReadonlyArray<string>).includes(nombre);
}

/** Nombre público para el cliente: 'Público general' cuando no es del padrón. */
export const PUBLICO_GENERAL = "Público general";
/** Candidatos que devuelve seleccionar_cliente: pocos, para que el vendedor elija. */
export const CANDIDATOS_MAX = 5;
/** Pedidos ya enviados que ver_pedido le recuerda a un cliente sin borrador. */
const ULTIMOS_PEDIDOS_CLIENTE = 3;
const DESCRIPCION_MAX = 200;
const SUCURSAL_DEFAULT: SucursalEntrega = "matriz";
/** Usuario con el que se firman en la bitácora los eventos que dispara el cliente
 *  (mismo literal que usa la capa de datos al crear su borrador). */
const USUARIO_CLIENTE = "cliente";

const SUCURSALES_TEXTO = SUCURSALES_ENTREGA.map((s) => `'${s.clave}' (${s.nombre})`).join(" o ");

// Las descripciones le dicen al modelo CUÁNDO llamar cada tool y de dónde sacar
// los datos, porque el error típico no es de formato sino de flujo: confirmar
// sin que el cliente haya dicho que sí, o inventar un código que no buscó.
// El input_schema es JSON Schema plano (type/properties/required) para que
// sirva igual en Anthropic y en OpenAI (agente-modelo.ts lo pasa tal cual).
const SELECCIONAR_CLIENTE: Anthropic.Tool = {
  name: "seleccionar_cliente",
  description:
    "SOLO para el vendedor del mostrador. Busca en el padrón de clientes con descuento por nombre, celular o RFC y devuelve hasta 5 candidatos (id, nombre, celular, descuento). NO cambia al cliente del pedido: la selección la hace el vendedor en pantalla. Úsala cuando el vendedor pregunte por un cliente o quiera atender a otro, y después pídele que lo elija en pantalla. Con publicoGeneral=true solo confirma que se atenderá a precio de mostrador.",
  input_schema: {
    type: "object" as const,
    properties: {
      busqueda: {
        type: "string",
        description: "Nombre (o parte), celular o RFC del cliente a buscar en el padrón.",
      },
      publicoGeneral: {
        type: "boolean",
        description: "true si el vendedor quiere atender como público general (sin descuento de padrón).",
      },
    },
  },
};

const AGREGAR_AL_PEDIDO: Anthropic.Tool = {
  name: "agregar_al_pedido",
  description:
    "Agrega una pieza al pedido en captura (lo abre si todavía no existe). Manda el código EXACTO que devolvió buscar_productos (pieza nueva) o el idPieza que devolvió buscar_piezas_usadas (pieza usada), nunca los dos. Nunca inventes el código: si no lo buscaste en esta conversación, busca primero. El precio lo calcula el servidor con el descuento del cliente; si la misma pieza ya estaba en el pedido se le suma la cantidad. Devuelve el pedido completo con partidas y totales con IVA.",
  input_schema: {
    type: "object" as const,
    properties: {
      codigo: {
        type: "string",
        description: "Código exacto de la pieza NUEVA tal como lo devolvió buscar_productos (p. ej. 'DDDAI15').",
      },
      idPiezaUsada: {
        type: "integer",
        description: "idPieza de la pieza USADA tal como lo devolvió buscar_piezas_usadas.",
      },
      cantidad: {
        type: "integer",
        description: "Piezas que quiere el cliente (1 a 99).",
      },
    },
    required: ["cantidad"],
  },
};

const VER_PEDIDO: Anthropic.Tool = {
  name: "ver_pedido",
  description:
    "Devuelve el pedido en captura: partidas con código, cantidad, precio unitario con IVA e importe, sucursal donde recoge y totales. Úsala para mostrarle el resumen al cliente antes de confirmar, o cuando pregunte qué lleva su pedido. Si no hay pedido en captura lo dice.",
  input_schema: { type: "object" as const, properties: {} },
};

const QUITAR_DEL_PEDIDO: Anthropic.Tool = {
  name: "quitar_del_pedido",
  description:
    "Quita una partida del pedido en captura. Identifícala por idPartida (viene en ver_pedido) o por el código de la pieza nueva. Devuelve el pedido actualizado.",
  input_schema: {
    type: "object" as const,
    properties: {
      idPartida: { type: "integer", description: "idPartida del renglón, tal como lo devolvió ver_pedido." },
      codigo: { type: "string", description: "Código exacto de la pieza nueva que se quita." },
    },
  },
};

const CAMBIAR_SUCURSAL: Anthropic.Tool = {
  name: "cambiar_sucursal",
  description: `Cambia la sucursal donde el cliente recoge el pedido: ${SUCURSALES_TEXTO}. Si todavía no hay pedido en captura, lo abre con esa sucursal.`,
  input_schema: {
    type: "object" as const,
    properties: {
      sucursal: {
        type: "string",
        enum: SUCURSALES_ENTREGA.map((s) => s.clave),
        description: `Clave de la sucursal: ${SUCURSALES_TEXTO}.`,
      },
    },
    required: ["sucursal"],
  },
};

const CONFIRMAR_PEDIDO: Anthropic.Tool = {
  name: "confirmar_pedido",
  description:
    "Envía el pedido en captura al mostrador: recibe folio (P-000123) y ya no se puede editar. Llámala SOLO después de mostrar el resumen (ver_pedido) y de que el cliente o el vendedor haya dicho que sí de forma explícita. El pedido queda sujeto a confirmación de existencia por el mostrador; no es un apartado.",
  input_schema: {
    type: "object" as const,
    properties: {
      sucursal: {
        type: "string",
        enum: SUCURSALES_ENTREGA.map((s) => s.clave),
        description: `Sucursal donde recoge, si la cambia al confirmar: ${SUCURSALES_TEXTO}.`,
      },
      observaciones: {
        type: "string",
        description: "Nota para el mostrador (color, lado, referencia del cliente), opcional.",
      },
    },
  },
};

const CANCELAR_PEDIDO: Anthropic.Tool = {
  name: "cancelar_pedido",
  description:
    "Cancela el pedido en captura (el que todavía no se ha confirmado). Úsala solo cuando el cliente o el vendedor lo pida claramente.",
  input_schema: {
    type: "object" as const,
    properties: {
      motivo: { type: "string", description: "Por qué se cancela, opcional." },
    },
  },
};

/** Las tools de pedido que le tocan al actor: ninguna si no puede pedir;
 *  seleccionar_cliente solo para el vendedor (un cliente pide para sí mismo). */
export function herramientasPedidoPara(actor: ActorVendedor | undefined): Anthropic.Tool[] {
  if (!puedePedir(actor)) return [];
  const comunes = [AGREGAR_AL_PEDIDO, VER_PEDIDO, QUITAR_DEL_PEDIDO, CAMBIAR_SUCURSAL, CONFIRMAR_PEDIDO, CANCELAR_PEDIDO];
  return actor.tipo === "vendedor" ? [SELECCIONAR_CLIENTE, ...comunes] : comunes;
}

// ---------------------------------------------------------------------------
// Forma de respuesta de las tools (contrato con vendedor-cifras.ts).
// ---------------------------------------------------------------------------

export interface PartidaParaModelo {
  idPartida: number;
  partida: number;
  origen: PartidaPedido["origen"];
  codigo: string | null;
  idPiezaUsada: number | null;
  descripcion: string;
  cantidad: number;
  precioConIva: number;
  importe: number;
  existenciaAlPedir: number | null;
}

export interface PedidoParaModelo {
  id: number;
  folio: string | null;
  estatus: PedidoDetalle["estatus"];
  cliente: string;
  descuentoPct: number;
  sucursal: SucursalEntrega;
  sucursalNombre: string;
  subtotal: number;
  iva: number;
  total: number;
  numPartidas: number;
  partidas: PartidaParaModelo[];
}

export interface ResultadoPartida {
  codigo: string | null;
  descripcion: string;
  precioConIva: number;
  cantidad: number;
  importe: number;
}

/**
 * Lo que toda tool de pedido devuelve. `resultados`, `folios` e `importes`
 * repiten datos del pedido a propósito: son los campos que registrarResultado
 * (vendedor-cifras.ts) apunta para que el folio y los totales que el agente
 * cite tal cual no salgan marcados como inventados.
 */
export interface RespuestaPedido {
  pedido: PedidoParaModelo | null;
  resultados: ResultadoPartida[];
  folios: string[];
  importes: number[];
}

export function nombreSucursal(clave: SucursalEntrega): string {
  return SUCURSALES_ENTREGA.find((s) => s.clave === clave)?.nombre ?? clave;
}

function partidaParaModelo(p: PartidaPedido): PartidaParaModelo {
  return {
    idPartida: p.id,
    partida: p.partida,
    origen: p.origen,
    codigo: p.codigo,
    idPiezaUsada: p.idPiezaUsada,
    descripcion: p.descripcion,
    cantidad: p.cantidad,
    precioConIva: p.precioUnitario,
    importe: p.importe,
    existenciaAlPedir: p.existenciaAlPedir,
  };
}

/** Resume un PedidoDetalle (sin eventos ni teléfono) en la forma del contrato. Pura. */
export function formatearRespuestaPedido(pedido: PedidoDetalle | null): RespuestaPedido {
  if (!pedido) return { pedido: null, resultados: [], folios: [], importes: [] };
  const partidas = pedido.partidas.map(partidaParaModelo);
  return {
    pedido: {
      id: pedido.id,
      folio: pedido.folio,
      estatus: pedido.estatus,
      cliente: pedido.cliente,
      descuentoPct: pedido.descuentoPct,
      sucursal: pedido.sucursal,
      sucursalNombre: nombreSucursal(pedido.sucursal),
      subtotal: pedido.subtotal,
      iva: pedido.iva,
      total: pedido.total,
      numPartidas: partidas.length,
      partidas,
    },
    resultados: partidas.map((p) => ({
      codigo: p.codigo,
      descripcion: p.descripcion,
      precioConIva: p.precioConIva,
      cantidad: p.cantidad,
      importe: p.importe,
    })),
    folios: pedido.folio ? [pedido.folio] : [],
    importes: [pedido.subtotal, pedido.iva, pedido.total, ...partidas.map((p) => p.importe)],
  };
}

// ---------------------------------------------------------------------------
// Del actor de Vico al actor de captura, el descuento y el canal.
// ---------------------------------------------------------------------------

function capturaDe(actor: ActorConPedido): ActorCaptura {
  return actor.tipo === "vendedor"
    ? { tipo: "vendedor", usuario: actor.usuario }
    : { tipo: "cliente", telefono: actor.telefono };
}

/** El vendedor captura desde el POS de vidaurri-page; el cliente, por WhatsApp. */
function canalDe(actor: ActorConPedido): CanalPedido {
  return actor.tipo === "vendedor" ? "mostrador" : "whatsapp";
}

function usuarioDe(actor: ActorConPedido): string {
  return actor.tipo === "vendedor" ? actor.usuario : USUARIO_CLIENTE;
}

/** Descuento con el que se cotiza la partida: el del cliente atendido (o
 *  ninguno = precio de mostrador). Nunca sale de lo que diga el modelo. */
function descuentoDe(actor: ActorConPedido): number | null {
  return actor.descuento;
}

function datosBorradorDe(actor: ActorConPedido, sucursal: SucursalEntrega): DatosBorrador {
  if (actor.tipo === "cliente") {
    return {
      canal: "whatsapp",
      idCliente: actor.idCliente,
      cliente: actor.nombre,
      telefono: actor.telefono,
      descuentoPct: actor.descuento,
      sucursal,
    };
  }
  return {
    canal: "mostrador",
    idCliente: actor.idCliente,
    cliente: actor.clienteNombre ?? PUBLICO_GENERAL,
    telefono: actor.clienteTelefono,
    descuentoPct: actor.descuento ?? 0,
    sucursal,
  };
}

function borradorDe(actor: ActorConPedido): Promise<PedidoDetalle | null> {
  return obtenerBorrador(capturaDe(actor));
}

/**
 * ¿El borrador es para el cliente que el actor atiende AHORA? El cliente por
 * WhatsApp solo tiene borradores suyos; el vendedor puede haber cambiado de
 * cliente en pantalla y traer todavía el borrador del anterior, cuyas partidas
 * llevan el descuento de aquel y no sirven para este.
 */
function esDelClienteAtendido(pedido: PedidoDetalle, actor: ActorConPedido): boolean {
  if (actor.tipo === "cliente") return true;
  return pedido.idCliente === actor.idCliente;
}

/** Error para el modelo cuando el borrador vivo no es del cliente en pantalla. */
function errorClienteDistinto(pedido: PedidoDetalle, actor: ActorConPedido): string | null {
  if (esDelClienteAtendido(pedido, actor)) return null;
  const atendido = actor.tipo === "vendedor" ? (actor.clienteNombre ?? PUBLICO_GENERAL) : actor.nombre;
  return `El pedido en captura es para ${pedido.cliente}, pero en pantalla está seleccionado ${atendido}. Pídele al vendedor que elija al cliente correcto, o cancela el pedido con cancelar_pedido para empezar otro.`;
}

/**
 * El borrador vivo del actor o uno nuevo. Siempre pasa por crearBorrador: si
 * el que había es del cliente atendido lo reutiliza y le refresca el
 * descuento del padrón (con el que se cotiza cada partida), conservando su
 * sucursal; si era para OTRO cliente, la capa de datos lo cancela y abre
 * otro, y se avisa en `nota` para que el agente se lo diga al vendedor en vez
 * de que lo descubra por un total que no cuadra.
 */
async function abrirBorrador(
  actor: ActorConPedido,
  sucursal: SucursalEntrega = SUCURSAL_DEFAULT
): Promise<{ pedido: PedidoDetalle; nota: string | null }> {
  const previo = await borradorDe(actor);
  const reutilizable = previo !== null && esDelClienteAtendido(previo, actor);
  const pedido = await crearBorrador(
    capturaDe(actor),
    datosBorradorDe(actor, reutilizable ? previo.sucursal : sucursal)
  );
  const nota =
    previo && !reutilizable
      ? `El pedido en captura anterior (para ${previo.cliente}) se canceló; este es para ${pedido.cliente}.`
      : null;
  return { pedido, nota };
}

// ---------------------------------------------------------------------------
// Lectura del input del modelo (no se confía en él).
// ---------------------------------------------------------------------------

function leerEntero(crudo: unknown): number | null {
  const numero = typeof crudo === "string" ? Number(crudo.trim()) : crudo;
  return typeof numero === "number" && Number.isSafeInteger(numero) && numero > 0 ? numero : null;
}

function leerTexto(crudo: unknown, maximo: number): string | null {
  if (crudo == null) return null;
  const texto = limpiarTexto(String(crudo)).slice(0, maximo);
  return texto || null;
}

type Salida = Record<string, unknown>;

function conError(error: string): Salida {
  return { error };
}

// ---------------------------------------------------------------------------
// Las tools.
// ---------------------------------------------------------------------------

async function seleccionarCliente(input: Record<string, unknown>, actor: ActorConPedido): Promise<Salida> {
  if (actor.tipo !== "vendedor") return conError("Solo el vendedor del mostrador puede cambiar de cliente");
  const atendiendo = actor.clienteNombre ?? PUBLICO_GENERAL;
  const base = { ...formatearRespuestaPedido(await borradorDe(actor)), atendiendo };

  if (input.publicoGeneral === true) {
    return {
      ...base,
      clientes: [],
      nota: `Pídele al vendedor que elija "${PUBLICO_GENERAL}" en pantalla; mientras, sigues atendiendo a ${atendiendo}.`,
    };
  }
  const busqueda = leerTexto(input.busqueda, BUSQUEDA_MAX);
  if (!busqueda) return conError("Indica el nombre, celular o RFC del cliente que buscas");

  const pagina = await listarClientesDescuento({ busqueda, pagina: 1, porPagina: CANDIDATOS_MAX });
  const clientes = pagina.registros.map((c) => ({
    id: c.id,
    nombre: c.cliente,
    celular: c.telefono,
    descuento: c.descuento,
  }));
  const nota =
    clientes.length === 0
      ? "No hay clientes en el padrón con esa búsqueda: el vendedor puede darlo de alta en pantalla o atenderlo como público general."
      : `${pagina.total} coincidencia(s) en el padrón. La selección NO se hace desde el chat: pídele al vendedor que elija al cliente en pantalla; hasta entonces sigues atendiendo a ${atendiendo}.`;
  return { ...base, clientes, nota };
}

/** Resuelve precio, descripción y existencia de lo que se agrega, en el catálogo que toque. */
async function resolverPartida(
  datos: { codigo: string | null; idPiezaUsada: number | null; cantidad: number },
  descuento: number | null
): Promise<{ ok: true; partida: PartidaNueva } | { ok: false; error: string }> {
  if (datos.idPiezaUsada !== null) {
    const pieza = await piezaUsadaParaPedido(datos.idPiezaUsada);
    if (!pieza) {
      return { ok: false, error: `La pieza usada #${datos.idPiezaUsada} ya no está en existencia en la Bodega Usado` };
    }
    const sobra = errorCantidadUsada(pieza.existencia, datos.cantidad);
    if (sobra) return { ok: false, error: `${sobra} (pieza usada #${pieza.idPieza})` };
    const vehiculo = [pieza.marca, pieza.modelo].filter(Boolean).join(" ");
    return {
      ok: true,
      partida: {
        origen: "usada",
        codigo: null,
        idPiezaUsada: pieza.idPieza,
        descripcion: (vehiculo ? `${pieza.descripcion} · ${vehiculo}` : pieza.descripcion).slice(0, DESCRIPCION_MAX),
        cantidad: datos.cantidad,
        precioUnitario: pieza.precioConIva,
        existenciaAlPedir: pieza.existencia,
      },
    };
  }
  const articulo = await articuloParaPedido(datos.codigo ?? "", descuento);
  if (!articulo) {
    const motivo = await motivoSinArticulo(datos.codigo ?? "", descuento);
    return {
      ok: false,
      error:
        motivo === "sin_precio_lista"
          ? `El código ${datos.codigo} está en el catálogo pero no tiene precio de lista, así que no se le puede aplicar el descuento del cliente. Solo se puede pedir a precio de mostrador (público general).`
          : `No encontré el código ${datos.codigo} en el catálogo. Búscalo con buscar_productos y usa el código exacto; si es pieza usada manda idPiezaUsada.`,
    };
  }
  return {
    ok: true,
    partida: {
      origen: "nueva",
      codigo: articulo.codigo,
      idPiezaUsada: null,
      descripcion: articulo.descripcion.slice(0, DESCRIPCION_MAX),
      cantidad: datos.cantidad,
      precioUnitario: articulo.precioConIva,
      existenciaAlPedir: articulo.existencia,
    },
  };
}

/** El renglón del pedido que corresponde a la partida recién agregada (la
 *  capa de datos suma cantidades si la pieza ya estaba). Pura. */
export function partidaEnPedido(
  pedido: PedidoDetalle,
  referencia: { codigo: string | null; idPiezaUsada: number | null }
): PartidaPedido | undefined {
  if (referencia.idPiezaUsada !== null) {
    return pedido.partidas.find((p) => p.idPiezaUsada === referencia.idPiezaUsada);
  }
  const codigo = referencia.codigo?.toUpperCase() ?? null;
  return pedido.partidas.find((p) => p.idPiezaUsada === null && p.codigo?.toUpperCase() === codigo);
}

/**
 * Aviso para el modelo cuando el pedido pide más de lo que hay. Se compara
 * contra la cantidad ACUMULADA del renglón, no contra lo que se acaba de
 * agregar: repetir una pieza también rebasa la existencia. Pura.
 */
export function avisoExistencia(existencia: number, cantidadEnPedido: number): string | null {
  if (existencia >= cantidadEnPedido) return null;
  return `Solo hay ${existencia} en existencia de ${cantidadEnPedido} pedidas: el mostrador confirmará cuántas surte y si el resto va sobre pedido.`;
}

async function agregarAlPedido(input: Record<string, unknown>, actor: ActorConPedido): Promise<Salida> {
  const validacion = validarCapturaPartida(input);
  if (!validacion.ok) return conError(validacion.error);

  const resuelta = await resolverPartida(validacion.datos, descuentoDe(actor));
  if (!resuelta.ok) return conError(resuelta.error);
  const { partida } = resuelta;

  const { pedido: borrador, nota } = await abrirBorrador(actor);
  const pedido = await agregarPartida(borrador.id, partida, usuarioDe(actor), canalDe(actor));

  const existencia = partida.existenciaAlPedir ?? 0;
  const cantidadEnPedido = partidaEnPedido(pedido, partida)?.cantidad ?? partida.cantidad;
  const avisos = [nota, avisoExistencia(existencia, cantidadEnPedido)].filter((a): a is string => a !== null);
  return {
    ...formatearRespuestaPedido(pedido),
    agregada: {
      codigo: partida.codigo,
      idPiezaUsada: partida.idPiezaUsada,
      descripcion: partida.descripcion,
      cantidad: partida.cantidad,
      cantidadEnPedido,
      precioConIva: partida.precioUnitario,
      existencia,
    },
    nota: avisos.length > 0 ? avisos.join(" ") : null,
  };
}

async function verPedido(actor: ActorConPedido): Promise<Salida> {
  const pedido = await borradorDe(actor);
  if (pedido) return { ...formatearRespuestaPedido(pedido), nota: errorClienteDistinto(pedido, actor) };

  const salida: Salida & RespuestaPedido = {
    ...formatearRespuestaPedido(null),
    nota: "No hay pedido en captura. Agrega piezas con agregar_al_pedido.",
  };
  // Al cliente se le recuerdan sus últimos pedidos ya enviados: después de
  // confirmar, "¿cómo va mi pedido?" no debe contestarse con "no tienes pedido".
  if (actor.tipo === "cliente") {
    const ultimos = await ultimosPedidosDeTelefono(actor.telefono, ULTIMOS_PEDIDOS_CLIENTE);
    salida.ultimos = ultimos.map((p) => ({
      folio: p.folio,
      estatus: p.estatus,
      sucursal: p.sucursal,
      sucursalNombre: nombreSucursal(p.sucursal),
      total: p.total,
      numPartidas: p.numPartidas,
      enviadoEn: p.enviadoEn,
    }));
    salida.folios = ultimos.map((p) => p.folio).filter((f): f is string => Boolean(f));
    salida.importes = ultimos.map((p) => p.total);
  }
  return salida;
}

async function quitarDelPedido(input: Record<string, unknown>, actor: ActorConPedido): Promise<Salida> {
  const pedido = await borradorDe(actor);
  if (!pedido) return conError("No hay pedido en captura");
  const ajeno = errorClienteDistinto(pedido, actor);
  if (ajeno) return conError(ajeno);

  const idPartida = leerEntero(input.idPartida);
  const codigo = leerTexto(input.codigo, DESCRIPCION_MAX)?.toUpperCase() ?? null;
  if (!idPartida && !codigo) return conError("Indica idPartida (de ver_pedido) o el código de la pieza");

  const partida = pedido.partidas.find(
    (p) => (idPartida !== null && p.id === idPartida) || (codigo !== null && p.codigo?.toUpperCase() === codigo)
  );
  if (!partida) return conError(`Esa pieza no está en el pedido (${idPartida ? `idPartida ${idPartida}` : codigo})`);

  const actualizado = await quitarPartida(pedido.id, partida.id, usuarioDe(actor), canalDe(actor));
  return { ...formatearRespuestaPedido(actualizado), quitada: partidaParaModelo(partida) };
}

async function cambiarSucursalPedido(input: Record<string, unknown>, actor: ActorConPedido): Promise<Salida> {
  const sucursal = input.sucursal;
  if (!esSucursal(sucursal)) return conError(`Sucursal inválida: usa ${SUCURSALES_TEXTO}`);

  const { pedido: borrador, nota } = await abrirBorrador(actor, sucursal);
  const pedido =
    borrador.sucursal === sucursal
      ? borrador
      : await cambiarSucursal(borrador.id, sucursal, usuarioDe(actor), canalDe(actor));
  return {
    ...formatearRespuestaPedido(pedido),
    nota: [nota, `Recoge en ${nombreSucursal(sucursal)}.`].filter(Boolean).join(" "),
  };
}

async function confirmarPedido(input: Record<string, unknown>, actor: ActorConPedido): Promise<Salida> {
  const borrador = await borradorDe(actor);
  if (!borrador) return conError("No hay pedido en captura que confirmar");
  const ajeno = errorClienteDistinto(borrador, actor);
  if (ajeno) return conError(ajeno);
  if (borrador.partidas.length === 0) return conError("El pedido no tiene partidas: agrega piezas antes de confirmar");

  const sucursalCruda = input.sucursal;
  if (sucursalCruda != null && sucursalCruda !== "" && !esSucursal(sucursalCruda)) {
    return conError(`Sucursal inválida: usa ${SUCURSALES_TEXTO}`);
  }
  if (esSucursal(sucursalCruda) && sucursalCruda !== borrador.sucursal) {
    await cambiarSucursal(borrador.id, sucursalCruda, usuarioDe(actor), canalDe(actor));
  }

  const observaciones = leerTexto(input.observaciones, OBSERVACIONES_MAX);
  const enviado = await enviarPedido(borrador.id, usuarioDe(actor), canalDe(actor), observaciones);
  return {
    ...formatearRespuestaPedido(enviado),
    nota: `Pedido ${enviado.folio} enviado al mostrador; recoge en ${nombreSucursal(enviado.sucursal)}. Queda sujeto a confirmación de existencia: el mostrador avisa cuando esté listo.`,
  };
}

async function cancelarPedido(input: Record<string, unknown>, actor: ActorConPedido): Promise<Salida> {
  const borrador = await borradorDe(actor);
  if (!borrador) return conError("No hay pedido en captura que cancelar");

  const motivo = leerTexto(input.motivo, MOTIVO_MAX) ?? "Cancelado desde el chat";
  const cancelado = await cancelarBorrador(capturaDe(actor), canalDe(actor), motivo);
  if (!cancelado) return conError("No hay pedido en captura que cancelar");
  // Se relee para devolver el estatus real (cancelado) y no el borrador de antes.
  const pedido = await obtenerPedido(borrador.id);
  return {
    ...formatearRespuestaPedido(pedido),
    nota: "Pedido en captura cancelado; no se envió nada al mostrador.",
  };
}

/** Mensaje para el modelo cuando la capa de datos rechaza la operación. */
function mensajeDeError(error: unknown): string {
  if (
    error instanceof PedidoNoEditableError ||
    error instanceof PedidoVacioError ||
    error instanceof LimitePedidoError ||
    error instanceof PartidaNoEncontradaError ||
    error instanceof TransicionInvalidaError ||
    error instanceof PedidoNoEncontradoError
  ) {
    return error.message;
  }
  console.error("Error en herramienta de pedido del Vendedor IA:", error);
  return "No fue posible actualizar el pedido en este momento";
}

/**
 * Ejecuta una tool de pedido para el actor y devuelve el JSON que ve el modelo:
 * siempre { pedido, resultados, folios, importes, ... } o { error }.
 */
export async function ejecutarHerramientaPedido(uso: UsoHerramienta, actor: ActorVendedor): Promise<string> {
  if (!puedePedir(actor)) return JSON.stringify(conError("Este cliente no puede levantar pedidos por este canal"));
  try {
    const input = uso.input ?? {};
    let salida: Salida;
    switch (uso.name) {
      case "seleccionar_cliente":
        salida = await seleccionarCliente(input, actor);
        break;
      case "agregar_al_pedido":
        salida = await agregarAlPedido(input, actor);
        break;
      case "ver_pedido":
        salida = await verPedido(actor);
        break;
      case "quitar_del_pedido":
        salida = await quitarDelPedido(input, actor);
        break;
      case "cambiar_sucursal":
        salida = await cambiarSucursalPedido(input, actor);
        break;
      case "confirmar_pedido":
        salida = await confirmarPedido(input, actor);
        break;
      case "cancelar_pedido":
        salida = await cancelarPedido(input, actor);
        break;
      default:
        salida = conError("Herramienta de pedido desconocida");
    }
    return JSON.stringify(salida);
  } catch (error) {
    return JSON.stringify(conError(mensajeDeError(error)));
  }
}
