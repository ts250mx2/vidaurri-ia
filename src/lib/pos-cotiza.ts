import { idArticuloPorPartidaDe } from "@/lib/articulos-pedido";
import { consultaBdav } from "@/lib/db";
import { enTransaccionPos } from "@/lib/db-bdav-escritura";
import { obtenerClienteDescuento } from "@/lib/db-clientes-descuento";
import { ahoraMonterrey } from "@/lib/db-conversaciones";
import {
  PedidoNoEncontradoError,
  guardarCotizacionPos,
  leerCotizacionPos,
  obtenerPedido,
  type ResultadoCotizaPos,
} from "@/lib/db-pedidos";
import { IVA } from "@/lib/formato";
import {
  IVA_PEDIDOS,
  folioDeId,
  redondear2,
  type EstatusPedido,
  type PartidaPedido,
  type PedidoDetalle,
  type SucursalEntrega,
} from "@/lib/pedidos";

// Cotización de un pedido de mostrador en el POS (bdav): cuando el pedido
// queda listo se inserta como cotización VIGENTE en `cotiza` + `detalle_cotiza`
// para que el mostrador la cobre desde el punto de venta con un número que ya
// conoce; si el pedido se cancela, la cotización se marca CANCELADA.
//
// Es una de las dos escrituras de esta aplicación en bdav (la otra es la back
// order a Aldo, pos-backorder.ts) y va por el pool acotado de
// db-bdav-escritura.ts (lista blanca de sentencias). Todo lo demás de bdav
// (clientes, artículos) se sigue leyendo por consultaBdav.
//
// Reglas del POS que se respetan aquí y que verificó el dueño:
//   - cotiza.num_cotiza es un contador aparte (MAX+1). El POS no pone candado
//     y hay duplicados históricos: se numera bajo FOR UPDATE y se comprueba
//     después de insertar, con reintento si chocó.
//   - detalle_cotiza.precio es SIN IVA (precio_vta para público general);
//     subtotal = Σ total_partida, iva = subtotal * 0.16, total = subtotal + iva.
//   - Las cifras son float(7,2): tope 99,999.99.
//   - id_cte 1 = "NO REGISTRADO"; fecha_cot es DATE; estatus 'VIGENTE'.
//   - Las piezas usadas no existen en bdav: se omiten y se anotan en observa.
//
// Modo (POS_COTIZA_MODO): real escribe; simulacion arma y loguea el SQL sin
// tocar bdav (default: nunca se escribe al POS por un .env a medias); apagado
// no hace nada. La primera parte del archivo es pura (armado y sentencias) y
// se prueba sin base; la segunda la conecta con las bases.

// ---------------------------------------------------------------------------
// Configuración.
// ---------------------------------------------------------------------------

export type ModoCotizaPos = "real" | "simulacion" | "apagado";
const MODOS_COTIZA_POS: ReadonlyArray<ModoCotizaPos> = ["real", "simulacion", "apagado"];
export const MODO_COTIZA_POS_DEFAULT: ModoCotizaPos = "simulacion";

/** Modo a partir del valor de POS_COTIZA_MODO. Vacío o desconocido → simulación. */
export function leerModoCotizaPos(valor: string | undefined): ModoCotizaPos {
  const limpio = (valor ?? "").trim().toLowerCase();
  return (MODOS_COTIZA_POS as ReadonlyArray<string>).includes(limpio)
    ? (limpio as ModoCotizaPos)
    : MODO_COTIZA_POS_DEFAULT;
}

function modoActual(): ModoCotizaPos {
  const crudo = process.env.POS_COTIZA_MODO;
  const modo = leerModoCotizaPos(crudo);
  if (crudo?.trim() && crudo.trim().toLowerCase() !== modo) {
    console.warn(`[pos-cotiza] POS_COTIZA_MODO="${crudo}" no se reconoce; se usa "${modo}"`);
  }
  return modo;
}

// ---------------------------------------------------------------------------
// Armado puro.
// ---------------------------------------------------------------------------

/** clientes.id del cliente genérico del POS. */
export const ID_CTE_NO_REGISTRADO = 1;
/** Las cifras de cotiza y detalle_cotiza son float(7,2). */
export const TOPE_IMPORTE_POS = 99999.99;
/** Columnas VARCHAR de cotiza. */
const NOMBRE_MAX = 100;
const TELEFONO_MAX = 30;
const OBSERVA_MAX = 100;
const ESTATUS_VIGENTE = "VIGENTE";
const ESTATUS_CANCELADA = "CANCELADA";
/** Veces que se vuelve a numerar si el num_cotiza chocó con el POS. */
const INTENTOS_NUM_COTIZA = 3;
/** pedidos_mostrador.cotiza_pos_error es VARCHAR(200). */
const ERROR_MAX = 200;

export const ERROR_SIN_RENGLONES = "Ninguna partida se puede cotizar en el POS";
export const ERROR_TOPE = "El total rebasa el tope del POS (99,999.99)";

/** Cómo llama el POS a cada sucursal en la observación. */
const NOMBRE_SUCURSAL_POS: Readonly<Record<SucursalEntrega, string>> = { matriz: "Matriz", fierro: "Fierro" };

export interface CabeceraCotizacionPos {
  idCte: number;
  nombre: string;
  telefono: string;
  subtotal: number;
  iva: number;
  total: number;
  observa: string;
  estatus: "VIGENTE";
}

export interface RenglonCotizacionPos {
  idArticulo: number;
  /** Renglón 1..n dentro de la cotización del POS (sin los huecos de las omitidas). */
  partida: number;
  cantidad: number;
  /** SIN IVA, como lo guarda detalle_cotiza. */
  precio: number;
  totalPartida: number;
}

export interface CotizacionPos {
  cabecera: CabeceraCotizacionPos;
  renglones: RenglonCotizacionPos[];
  /** Partidas del pedido (por su número) que no van al POS y por qué. */
  omitidas: Array<{ partida: number; motivo: string }>;
}

export type PartidaACotizarPos = Pick<
  PartidaPedido,
  "partida" | "origen" | "codigo" | "idPiezaUsada" | "cantidad" | "precioUnitario"
>;

/** Lo que el armado necesita del pedido (un PedidoDetalle completo sirve tal cual). */
export type PedidoACotizarPos = Pick<PedidoDetalle, "id" | "folio" | "sucursal" | "cliente" | "telefono"> & {
  partidas: PartidaACotizarPos[];
};

export interface ContextoCotizacionPos {
  /** clientes.id en bdav, ya comprobado que existe; null = NO REGISTRADO. */
  idClienteBdav: number | null;
  /** articulos.id por número de partida del pedido; las que falten se omiten. */
  idArticuloPorPartida: Map<number, number>;
}

export type ArmadoCotizacionPos = { ok: true; cotizacion: CotizacionPos } | { ok: false; error: string };

function folioDe(pedido: Pick<PedidoDetalle, "id" | "folio">): string {
  return pedido.folio ?? folioDeId(pedido.id);
}

/** 'Pedido web P-000131 · recoge en Fierro +1 usada #18639', acotado a la columna. */
function armarObserva(pedido: PedidoACotizarPos, resumenOmitidas: string[]): string {
  const base = `Pedido web ${folioDe(pedido)} · recoge en ${NOMBRE_SUCURSAL_POS[pedido.sucursal]}`;
  return [base, ...resumenOmitidas].join(" ").slice(0, OBSERVA_MAX);
}

/**
 * Traduce el pedido a lo que el POS guarda. Solo van las partidas nuevas y
 * sobre pedido con artículo resuelto en bdav; las usadas (no existen allá) y
 * las que no se resolvieron se omiten y quedan anotadas en `observa`, para
 * que quien cobre sepa que falta algo. Los precios del pedido traen IVA; el
 * POS los guarda sin él y recalcula el IVA sobre el subtotal, así que aquí se
 * desglosa igual para que la cotización cante lo mismo que el pedido (a un
 * centavo de redondeo).
 */
export function armarCotizacionPos(pedido: PedidoACotizarPos, contexto: ContextoCotizacionPos): ArmadoCotizacionPos {
  const renglones: RenglonCotizacionPos[] = [];
  const omitidas: CotizacionPos["omitidas"] = [];
  const resumenOmitidas: string[] = [];

  for (const partida of pedido.partidas) {
    if (partida.origen === "usada") {
      const referencia = `usada #${partida.idPiezaUsada ?? "?"}`;
      omitidas.push({ partida: partida.partida, motivo: `${referencia}: el POS no cotiza usadas` });
      resumenOmitidas.push(`+${partida.cantidad} ${referencia}`);
      continue;
    }
    const idArticulo = contexto.idArticuloPorPartida.get(partida.partida);
    if (!idArticulo) {
      const referencia = partida.codigo ?? "sin código";
      omitidas.push({ partida: partida.partida, motivo: `${referencia}: sin artículo en bdav` });
      resumenOmitidas.push(`+${partida.cantidad} ${referencia} (sin artículo)`);
      continue;
    }
    const precio = redondear2(partida.precioUnitario / IVA_PEDIDOS);
    renglones.push({
      idArticulo,
      partida: renglones.length + 1,
      cantidad: partida.cantidad,
      precio,
      totalPartida: redondear2(partida.cantidad * precio),
    });
  }

  if (renglones.length === 0) return { ok: false, error: ERROR_SIN_RENGLONES };

  const subtotal = redondear2(renglones.reduce((suma, r) => suma + r.totalPartida, 0));
  const iva = redondear2(subtotal * IVA);
  const total = redondear2(subtotal + iva);
  if (total > TOPE_IMPORTE_POS) return { ok: false, error: ERROR_TOPE };

  const idCte =
    contexto.idClienteBdav !== null && contexto.idClienteBdav > 0 ? contexto.idClienteBdav : ID_CTE_NO_REGISTRADO;
  return {
    ok: true,
    cotizacion: {
      cabecera: {
        idCte,
        nombre: pedido.cliente.slice(0, NOMBRE_MAX),
        // El POS guarda '' cuando no hay teléfono, no NULL.
        telefono: (pedido.telefono ?? "").slice(0, TELEFONO_MAX),
        subtotal,
        iva,
        total,
        observa: armarObserva(pedido, resumenOmitidas),
        estatus: ESTATUS_VIGENTE,
      },
      renglones,
      omitidas,
    },
  };
}

/** Un pedido se puede (re)cotizar en el POS cuando el mostrador ya lo surtió. */
export function puedeCotizarEnPos(estatus: EstatusPedido): boolean {
  return estatus === "listo" || estatus === "entregado";
}

// ---------------------------------------------------------------------------
// Sentencias (las mismas que se ejecutan en modo real y se loguean en simulación).
// Su forma exacta la exige la lista blanca de db-bdav-escritura.ts.
// ---------------------------------------------------------------------------

export interface SentenciaPos {
  sql: string;
  params: unknown[];
}

/**
 * El último número, leído por la llave primaria (una fila) y SIN `FOR UPDATE`.
 *
 * `num_cotiza` no tiene índice, así que `MAX(num_cotiza) ... FOR UPDATE` recorre
 * y bloquea las 166 mil filas de `cotiza` mientras dura la transacción, y eso sí
 * frena al POS al guardar sus propias cotizaciones. El candado tampoco servía de
 * nada: el POS numera con una lectura normal, que no lo respeta. Lo que protege
 * de verdad es la comprobación de después de insertar. En bdav `num_cotiza`
 * nunca baja al crecer el `id` (comprobado sobre las 166 mil filas: las únicas
 * excepciones son números repetidos, que valen igual, no menos), así que la
 * fila de mayor `id` es la del número más alto.
 */
export const SQL_ULTIMO_NUM_COTIZA = "SELECT num_cotiza AS n FROM cotiza ORDER BY id DESC LIMIT 1";
/**
 * ¿Alguien más se quedó con este número? Acotado por `id` para no recorrer la
 * tabla entera: un choque solo puede venir del POS guardando en el mismo
 * instante, y esa fila queda a unos pocos ids de la nuestra (el mostrador
 * levanta unas 150 cotizaciones al día). Un repetido histórico es imposible:
 * el número que tomamos es mayor que todos los que existían.
 */
export const SQL_CONTAR_NUM_COTIZA = "SELECT COUNT(*) AS c FROM cotiza WHERE num_cotiza = ? AND id >= ?";
/** Cuántos ids hacia atrás mira esa comprobación. */
export const VENTANA_CHOQUE_COTIZA = 1000;
export const SQL_CANCELAR_COTIZA = "UPDATE cotiza SET estatus = ? WHERE id = ?";

/** INSERT de la cabecera. `numCotiza` admite un texto solo para el log de la simulación. */
export function sentenciaCabecera(
  cabecera: CabeceraCotizacionPos,
  numCotiza: number | string,
  fechaCot: string
): SentenciaPos {
  return {
    sql: `INSERT INTO cotiza (id_cte, num_cotiza, nombre, telefono, fecha_cot, subtotal, iva, total, observa, estatus)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'VIGENTE')`,
    params: [
      cabecera.idCte,
      numCotiza,
      cabecera.nombre,
      cabecera.telefono,
      fechaCot,
      cabecera.subtotal,
      cabecera.iva,
      cabecera.total,
      cabecera.observa,
    ],
  };
}

/** INSERT de un renglón. `idCot` es el insertId de la cabecera (o un texto en el log de la simulación). */
export function sentenciaRenglon(idCot: number | string, renglon: RenglonCotizacionPos): SentenciaPos {
  return {
    sql: `INSERT INTO detalle_cotiza (id_cot, id_articulo, partida, cantidad, precio, total_partida)
   VALUES (?, ?, ?, ?, ?, ?)`,
    params: [idCot, renglon.idArticulo, renglon.partida, renglon.cantidad, renglon.precio, renglon.totalPartida],
  };
}

/** Texto para la pantalla cuando se corre en simulación: qué se habría insertado. */
export function resumirSimulacion(cotizacion: CotizacionPos): string {
  const { cabecera, renglones, omitidas } = cotizacion;
  const n = renglones.length;
  const base =
    `Simulada (no se escribió en el POS): ${n} ${n === 1 ? "renglón" : "renglones"}, id_cte ${cabecera.idCte}, ` +
    `subtotal ${cabecera.subtotal.toFixed(2)}, IVA ${cabecera.iva.toFixed(2)}, total ${cabecera.total.toFixed(2)}`;
  const extra = omitidas.length > 0 ? `; ${omitidas.length} omitida${omitidas.length === 1 ? "" : "s"}` : "";
  return (base + extra).slice(0, ERROR_MAX);
}

/** 'Cotización 166500 en el POS' (+ cuántas partidas se quedaron fuera). */
function detalleInsercion(numCotiza: number, cotizacion: CotizacionPos): string {
  const omitidas = cotizacion.omitidas.length;
  const extra = omitidas > 0 ? ` (${omitidas} partida${omitidas === 1 ? "" : "s"} omitida${omitidas === 1 ? "" : "s"})` : "";
  return `Cotización ${numCotiza} en el POS${extra}`;
}

// ---------------------------------------------------------------------------
// Con base.
// ---------------------------------------------------------------------------

/** clientes.id en bdav del cliente del pedido, solo si el padrón lo liga y el
 *  cliente sigue existiendo allá; si no, null (NO REGISTRADO). Lo comparte
 *  pos-backorder.ts: la back order lleva el mismo cliente que la cotización. */
export async function idClienteBdavDe(idCliente: number | null): Promise<number | null> {
  if (idCliente === null) return null;
  const cliente = await obtenerClienteDescuento(idCliente);
  const idBdav = cliente?.idClienteBdav ?? null;
  if (idBdav === null || idBdav <= 0) return null;
  const filas = await consultaBdav<{ id: number }>("SELECT id FROM clientes WHERE id = ? LIMIT 1", [idBdav]);
  return filas.length > 0 ? Number(filas[0].id) : null;
}

/** El num_cotiza que elegimos ya lo usó el POS en el mismo instante. */
class NumCotizaRepetidoError extends Error {
  readonly numCotiza: number;

  constructor(numCotiza: number) {
    super(`num_cotiza ${numCotiza} repetido`);
    this.name = "NumCotizaRepetidoError";
    this.numCotiza = numCotiza;
  }
}

interface InsercionPos {
  idCotiza: number;
  numCotiza: number;
}

/**
 * Inserta la cotización en bdav en una transacción: toma el número que sigue
 * al último, inserta cabecera y renglones y comprueba que nadie más se haya
 * quedado con ese número (el POS numera igual y sin candado, así que puede
 * pasar). Si chocó, deshace y vuelve con el siguiente, hasta
 * INTENTOS_NUM_COTIZA veces.
 */
async function insertarEnPos(cotizacion: CotizacionPos, fechaCot: string): Promise<InsercionPos> {
  let ultimoIntentado = 0;
  for (let intento = 1; ; intento++) {
    try {
      return await enTransaccionPos(async (ejecutar) => {
        const filas = (await ejecutar(SQL_ULTIMO_NUM_COTIZA)) as Array<{ n: number }>;
        const numCotiza = Math.max(Number(filas[0]?.n ?? 0) + 1, ultimoIntentado + 1);
        ultimoIntentado = numCotiza;

        const cabecera = sentenciaCabecera(cotizacion.cabecera, numCotiza, fechaCot);
        const insertada = (await ejecutar(cabecera.sql, cabecera.params)) as { insertId: number };
        for (const renglon of cotizacion.renglones) {
          const sentencia = sentenciaRenglon(insertada.insertId, renglon);
          await ejecutar(sentencia.sql, sentencia.params);
        }

        const desde = Math.max(1, insertada.insertId - VENTANA_CHOQUE_COTIZA);
        const conteo = (await ejecutar(SQL_CONTAR_NUM_COTIZA, [numCotiza, desde])) as Array<{ c: number }>;
        if (Number(conteo[0]?.c ?? 0) > 1) throw new NumCotizaRepetidoError(numCotiza);
        return { idCotiza: insertada.insertId, numCotiza };
      });
    } catch (error) {
      if (!(error instanceof NumCotizaRepetidoError) || intento >= INTENTOS_NUM_COTIZA) throw error;
      console.warn(`[pos-cotiza] ${error.message} (chocó con el POS); reintento ${intento + 1}/${INTENTOS_NUM_COTIZA}`);
    }
  }
}

/** Número que le tocaría a la cotización, solo para que el log de la simulación sea creíble. */
async function siguienteNumCotizaEstimado(): Promise<string> {
  try {
    const filas = await consultaBdav<{ n: number }>(SQL_ULTIMO_NUM_COTIZA);
    return `${Number(filas[0]?.n ?? 0) + 1} (estimado)`;
  } catch (error) {
    console.warn("[pos-cotiza] no se pudo estimar el num_cotiza para la simulación:", error);
    return "<MAX(num_cotiza)+1>";
  }
}

function mensajeDe(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, ERROR_MAX);
}

function guardarError(idPedido: number, mensaje: string, usuario: string | null): Promise<PedidoDetalle> {
  const error = mensaje.slice(0, ERROR_MAX);
  return guardarCotizacionPos(
    idPedido,
    { estado: "error", numCotizaPos: null, idCotizaPos: null, error, evento: "cotizacion_pos_error", detalle: error },
    usuario
  );
}

async function simular(
  idPedido: number,
  pedido: PedidoDetalle,
  cotizacion: CotizacionPos,
  fechaCot: string,
  usuario: string | null
): Promise<PedidoDetalle> {
  const sentencias = [
    sentenciaCabecera(cotizacion.cabecera, await siguienteNumCotizaEstimado(), fechaCot),
    ...cotizacion.renglones.map((r) => sentenciaRenglon("<insertId de la cabecera>", r)),
  ];
  console.info("[pos-cotiza] simulación (no se escribe en bdav)", {
    pedido: folioDe(pedido),
    cabecera: cotizacion.cabecera,
    renglones: cotizacion.renglones,
    omitidas: cotizacion.omitidas,
    sentencias,
  });
  const resumen = resumirSimulacion(cotizacion);
  return guardarCotizacionPos(
    idPedido,
    {
      estado: "simulada",
      numCotizaPos: null,
      idCotizaPos: null,
      error: resumen,
      evento: "cotizacion_pos_simulada",
      detalle: resumen,
    },
    usuario
  );
}

/**
 * Refleja el pedido como cotización en el POS según POS_COTIZA_MODO y deja en
 * el pedido cómo quedó (cotizaPosEstado, numCotizaPos, cotizaPosError). Si ya
 * está insertada no hace nada. Ningún error del POS sube: se guarda como
 * estado `error` con su mensaje y el pedido se devuelve igual, para que el
 * cambio de estatus que lo disparó nunca se rompa por esto. Solo se propaga
 * que el pedido no exista o que la propia base de pedidos falle.
 */
export async function sincronizarCotizacionPos(idPedido: number, usuario: string | null): Promise<PedidoDetalle> {
  const pedido = await obtenerPedido(idPedido);
  if (!pedido) throw new PedidoNoEncontradoError();
  if (pedido.cotizaPosEstado === "insertada") return pedido;

  const modo = modoActual();
  if (modo === "apagado") {
    return guardarCotizacionPos(
      idPedido,
      {
        estado: "omitida",
        numCotizaPos: null,
        idCotizaPos: null,
        error: null,
        evento: "cotizacion_pos_omitida",
        detalle: "Cotización en el POS apagada (POS_COTIZA_MODO=apagado)",
      },
      usuario
    );
  }

  try {
    const [idClienteBdav, idArticuloPorPartida] = await Promise.all([
      idClienteBdavDe(pedido.idCliente),
      idArticuloPorPartidaDe(pedido.partidas),
    ]);
    const armado = armarCotizacionPos(pedido, { idClienteBdav, idArticuloPorPartida });
    if (!armado.ok) return await guardarError(idPedido, armado.error, usuario);

    const { fecha } = ahoraMonterrey();
    if (modo === "simulacion") return await simular(idPedido, pedido, armado.cotizacion, fecha, usuario);

    const insercion = await insertarEnPos(armado.cotizacion, fecha);
    return await guardarCotizacionPos(
      idPedido,
      {
        estado: "insertada",
        numCotizaPos: insercion.numCotiza,
        idCotizaPos: insercion.idCotiza,
        error: null,
        evento: "cotizacion_pos",
        detalle: detalleInsercion(insercion.numCotiza, armado.cotizacion),
      },
      usuario
    );
  } catch (error) {
    console.error(`[pos-cotiza] cotizando el pedido ${folioDe(pedido)} en el POS:`, error);
    return guardarError(idPedido, mensajeDe(error), usuario);
  }
}

/**
 * Al cancelar el pedido, su cotización en el POS pasa a CANCELADA (modo real)
 * o se loguea (simulación); una cotización simulada solo cambia de estado. Si
 * no hay nada en el POS (pendiente, omitida, error, ya cancelada) no hace
 * nada. Un fallo al cancelar en el POS se anota en el pedido (queda insertada
 * con el error) y se loguea; no sube.
 */
export async function cancelarCotizacionPos(idPedido: number, usuario: string | null): Promise<void> {
  const guardada = await leerCotizacionPos(idPedido);
  if (!guardada) throw new PedidoNoEncontradoError();

  if (guardada.estado === "simulada") {
    console.info(`[pos-cotiza] simulación: se cancela la cotización simulada del pedido ${idPedido}`);
    await guardarCotizacionPos(
      idPedido,
      {
        estado: "cancelada",
        numCotizaPos: null,
        idCotizaPos: null,
        error: null,
        evento: "cotizacion_pos_cancelada",
        detalle: "Cotización simulada cancelada (no había nada en el POS)",
      },
      usuario
    );
    return;
  }
  if (guardada.estado !== "insertada" || guardada.idCotizaPos === null) return;

  const modo = modoActual();
  if (modo === "apagado") {
    console.warn(
      `[pos-cotiza] módulo apagado: la cotización ${guardada.numCotizaPos} del pedido ${idPedido} sigue VIGENTE en el POS`
    );
    return;
  }

  const cancelada: ResultadoCotizaPos = {
    estado: "cancelada",
    numCotizaPos: guardada.numCotizaPos,
    idCotizaPos: guardada.idCotizaPos,
    error: null,
    evento: "cotizacion_pos_cancelada",
    detalle: `Cotización ${guardada.numCotizaPos} cancelada en el POS${modo === "simulacion" ? " (simulación)" : ""}`,
  };
  try {
    if (modo === "real") {
      await enTransaccionPos(async (ejecutar) => {
        await ejecutar(SQL_CANCELAR_COTIZA, [ESTATUS_CANCELADA, guardada.idCotizaPos]);
      });
    } else {
      console.info("[pos-cotiza] simulación de cancelación (no se escribe en bdav)", {
        sql: SQL_CANCELAR_COTIZA,
        params: [ESTATUS_CANCELADA, guardada.idCotizaPos],
      });
    }
    await guardarCotizacionPos(idPedido, cancelada, usuario);
  } catch (error) {
    console.error(`[pos-cotiza] cancelando la cotización ${guardada.numCotizaPos} del pedido ${idPedido}:`, error);
    await guardarCotizacionPos(
      idPedido,
      {
        ...guardada,
        error: `No se pudo cancelar en el POS: ${mensajeDe(error)}`.slice(0, ERROR_MAX),
        evento: "cotizacion_pos_error",
        detalle: `No se pudo cancelar la cotización ${guardada.numCotizaPos} en el POS: ${mensajeDe(error)}`,
      },
      usuario
    );
  }
}
