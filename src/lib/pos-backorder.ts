import { idArticuloPorPartidaDe } from "@/lib/articulos-pedido";
import { consultaBdav } from "@/lib/db";
import { enTransaccionPos } from "@/lib/db-bdav-escritura";
import { ahoraMonterrey } from "@/lib/db-conversaciones";
import {
  PedidoNoEncontradoError,
  guardarBackorderPos,
  leerBackorderPos,
  leerIdVendedorPos,
  obtenerPedido,
  type BackorderPosGuardada,
  type ResultadoBkoPos,
} from "@/lib/db-pedidos";
import { IVA } from "@/lib/formato";
import {
  BKO_FIRMA_MAX,
  IVA_PEDIDOS,
  fechaCompromisoAldo,
  firmaBackorder,
  folioDeId,
  partidasParaBackorder,
  puedeTenerBackorder,
  redondear2,
  type CompromisoAldo,
  type PartidaPedido,
  type PedidoDetalle,
} from "@/lib/pedidos";
import { ID_CTE_NO_REGISTRADO, idClienteBdavDe, type SentenciaPos } from "@/lib/pos-cotiza";

// Back order a Aldo Autopartes desde el pedido web. Cuando el mostrador confirma
// un pedido (y cada vez que vuelve a confirmar partidas estando confirmado), las
// partidas sobre pedido se piden al proveedor como una back order en el POS
// (bdav): `back_order` + `detalle_bko`, con el número tomado de
// `folios_ventas.folio_bko`. Si el pedido se cancela o los renglones cambian, la
// back order vigente pasa a CANCELADA (y, si cambiaron, se pide otra).
//
// Es la segunda escritura de esta aplicación en bdav (la primera es la
// cotización, pos-cotiza.ts) y va por el mismo pool acotado de
// db-bdav-escritura.ts, con las cuatro sentencias que autorizó el dueño el
// 3 sep 2026. Todo lo demás de bdav se sigue leyendo por consultaBdav.
//
// Reglas del POS que se respetan aquí y que verificó el dueño:
//   - El número NO es MAX(num_bko)+1: el POS lo toma de folios_ventas.folio_bko
//     (la fila con folio_bko no nulo guarda el SIGUIENTE número) y lo sube. Aquí
//     se lee bajo FOR UPDATE y se sube con un UPDATE optimista (WHERE folio_bko
//     = lo que se leyó): si no afectó una fila, otro lo tomó y se reintenta la
//     transacción completa.
//   - detalle_bko.precio es SIN IVA; subtotal = Σ total_part, iva = subtotal ×
//     0.16, total = subtotal + iva, saldo = total (sin anticipo).
//   - id_prov 1 = ALDO AUTOPARTES; id_cte 1 = NO REGISTRADO; id_vendedor es de
//     `vendedores` (1 POLENDO, 2 ECHAVARRI, 3 JR) y sale de vendedores_pos por
//     el usuario del POS que confirmó, o de POS_BKO_VENDEDOR_DEFAULT.
//   - fecha_compromiso es 'MARTES' o 'VIERNES': los días que entrega Aldo.
//
// Una sola back order vigente por pedido. Se guarda la firma de los renglones
// (firmaBackorder): si la vigente tiene la misma, no se hace nada.
//
// Modo (POS_BKO_MODO): real escribe; simulacion arma y loguea sin tocar bdav
// (default: nunca se escribe al POS por un .env a medias); apagado no hace
// nada. La primera parte del archivo es pura (armado y sentencias) y se prueba
// sin base; la segunda la conecta con las bases.

// ---------------------------------------------------------------------------
// Configuración.
// ---------------------------------------------------------------------------

export type ModoBkoPos = "real" | "simulacion" | "apagado";
const MODOS_BKO_POS: ReadonlyArray<ModoBkoPos> = ["real", "simulacion", "apagado"];
export const MODO_BKO_POS_DEFAULT: ModoBkoPos = "simulacion";

/** Modo a partir del valor de POS_BKO_MODO. Vacío o desconocido → simulación. */
export function leerModoBkoPos(valor: string | undefined): ModoBkoPos {
  const limpio = (valor ?? "").trim().toLowerCase();
  return (MODOS_BKO_POS as ReadonlyArray<string>).includes(limpio) ? (limpio as ModoBkoPos) : MODO_BKO_POS_DEFAULT;
}

function modoActual(): ModoBkoPos {
  const crudo = process.env.POS_BKO_MODO;
  const modo = leerModoBkoPos(crudo);
  if (crudo?.trim() && crudo.trim().toLowerCase() !== modo) {
    console.warn(`[pos-backorder] POS_BKO_MODO="${crudo}" no se reconoce; se usa "${modo}"`);
  }
  return modo;
}

/** vendedores.id de JR, con el que el POS firma las back orders de mostrador. */
export const ID_VENDEDOR_DEFAULT = 3;

/** Vendedor por defecto a partir de POS_BKO_VENDEDOR_DEFAULT: entero > 0, si no JR. */
export function leerIdVendedorDefault(valor: string | undefined): number {
  const limpio = (valor ?? "").trim();
  return /^[1-9]\d*$/.test(limpio) ? Number(limpio) : ID_VENDEDOR_DEFAULT;
}

export function idVendedorDefault(): number {
  return leerIdVendedorDefault(process.env.POS_BKO_VENDEDOR_DEFAULT);
}

// ---------------------------------------------------------------------------
// Armado puro.
// ---------------------------------------------------------------------------

/** proveedores.id de ALDO AUTOPARTES: todo el catálogo de bdav es suyo. */
export const ID_PROV_ALDO = 1;
/** Columnas VARCHAR de back_order. */
const NOMBRE_CLIENTE_MAX = 200;
const TELEFONO_MAX = 20;
const COMENTARIOS_MAX = 200;
const ESTATUS_ABIERTA = "ABIERTA";
const ESTATUS_CANCELADA = "CANCELADA";
const ESTATUS_RENGLON_BKO = "BKO";
/** Veces que se vuelve a tomar el folio si el POS lo subió en el mismo instante. */
const INTENTOS_FOLIO_BKO = 3;
/** pedidos_mostrador.bko_pos_error es VARCHAR(200). */
const ERROR_MAX = 200;

export const ERROR_SIN_RENGLONES_BKO = "Ninguna partida se puede pedir a Aldo";
const MOTIVO_SIN_PARTIDAS = "Sin partidas sobre pedido";
const MOTIVO_APAGADO = "POS_BKO_MODO=apagado";

export interface CabeceraBackorderPos {
  idProv: number;
  idCte: number;
  idVendedor: number;
  /** 'AAAA-MM-DD' (DATE). */
  fechaBko: string;
  nombreCliente: string;
  /** Solo dígitos; '' cuando no hay, como lo guarda el POS. */
  telefono: string;
  email: string;
  subtotal: number;
  iva: number;
  total: number;
  anticipo: number;
  liquida: number;
  saldo: number;
  estatus: "ABIERTA";
  fechaCompromiso: CompromisoAldo;
  comentarios: string;
}

export interface RenglonBackorderPos {
  idArt: number;
  /** Renglón 1..n dentro de la back order (sin los huecos de las omitidas). */
  partida: number;
  cantidad: number;
  /** SIN IVA, como lo guarda detalle_bko. */
  precio: number;
  totalPart: number;
  estatus: "BKO";
}

export interface BackorderPos {
  cabecera: CabeceraBackorderPos;
  renglones: RenglonBackorderPos[];
  /** Partidas sobre pedido que no se pudieron pedir y por qué ('2 × XYZ (sin artículo en bdav)'). */
  omitidas: string[];
}

export type PartidaParaBackorderPos = Pick<
  PartidaPedido,
  "partida" | "origen" | "codigo" | "cantidad" | "precioUnitario" | "estatusPartida"
>;

/** Lo que el armado necesita del pedido (un PedidoDetalle completo sirve tal cual). */
export type PedidoParaBackorderPos = Pick<PedidoDetalle, "id" | "folio" | "cliente" | "telefono"> & {
  partidas: PartidaParaBackorderPos[];
};

export interface ContextoBackorderPos {
  /** clientes.id en bdav, ya comprobado que existe; null = NO REGISTRADO. */
  idClienteBdav: number | null;
  /** vendedores.id con el que se firma. */
  idVendedor: number;
  /** Hoy en Monterrey, 'AAAA-MM-DD'. */
  fechaBko: string;
  fechaCompromiso: CompromisoAldo;
  /** articulos.id por número de partida del pedido; las que falten se omiten. */
  idArticuloPorPartida: Map<number, number>;
}

export type ArmadoBackorderPos = { ok: true; backorder: BackorderPos } | { ok: false; error: string };

function folioDe(pedido: Pick<PedidoDetalle, "id" | "folio">): string {
  return pedido.folio ?? folioDeId(pedido.id);
}

/** Precio sin IVA como lo guarda detalle_bko: el del pedido trae IVA. */
export function precioSinIvaBko(precioUnitario: number): number {
  return redondear2(precioUnitario / IVA_PEDIDOS);
}

/** Totales de la cabecera a partir de los importes sin IVA de los renglones:
 *  el IVA se calcula sobre el subtotal ya redondeado, como hace el POS. */
export function totalesBko(importesSinIva: readonly number[]): { subtotal: number; iva: number; total: number } {
  const subtotal = redondear2(importesSinIva.reduce((suma, importe) => suma + importe, 0));
  const iva = redondear2(subtotal * IVA);
  const total = redondear2(subtotal + iva);
  return { subtotal, iva, total };
}

/**
 * Traduce el pedido a lo que el POS guarda como back order. Solo van las
 * partidas sobre pedido (partidasParaBackorder) con artículo resuelto en bdav;
 * las que no se resolvieron se omiten y quedan anotadas para el resumen. Los
 * precios del pedido traen IVA; el POS los guarda sin él y recalcula el IVA
 * sobre el subtotal, así que aquí se desglosa igual.
 */
export function armarBackorderPos(pedido: PedidoParaBackorderPos, contexto: ContextoBackorderPos): ArmadoBackorderPos {
  const renglones: RenglonBackorderPos[] = [];
  const omitidas: string[] = [];

  for (const partida of partidasParaBackorder(pedido.partidas)) {
    const idArt = contexto.idArticuloPorPartida.get(partida.partida);
    if (!idArt) {
      omitidas.push(`${partida.cantidad} × ${partida.codigo ?? "sin código"} (sin artículo en bdav)`);
      continue;
    }
    const precio = precioSinIvaBko(partida.precioUnitario);
    renglones.push({
      idArt,
      partida: renglones.length + 1,
      cantidad: partida.cantidad,
      precio,
      totalPart: redondear2(partida.cantidad * precio),
      estatus: ESTATUS_RENGLON_BKO,
    });
  }

  if (renglones.length === 0) return { ok: false, error: ERROR_SIN_RENGLONES_BKO };

  const { subtotal, iva, total } = totalesBko(renglones.map((r) => r.totalPart));
  const idCte =
    contexto.idClienteBdav !== null && contexto.idClienteBdav > 0 ? contexto.idClienteBdav : ID_CTE_NO_REGISTRADO;
  return {
    ok: true,
    backorder: {
      cabecera: {
        idProv: ID_PROV_ALDO,
        idCte,
        idVendedor: contexto.idVendedor,
        fechaBko: contexto.fechaBko,
        nombreCliente: pedido.cliente.slice(0, NOMBRE_CLIENTE_MAX),
        telefono: (pedido.telefono ?? "").replace(/\D/g, "").slice(0, TELEFONO_MAX),
        email: "",
        subtotal,
        iva,
        total,
        anticipo: 0,
        liquida: 0,
        saldo: total,
        estatus: ESTATUS_ABIERTA,
        fechaCompromiso: contexto.fechaCompromiso,
        comentarios: `Pedido web ${folioDe(pedido)}`.slice(0, COMENTARIOS_MAX),
      },
      renglones,
      omitidas,
    },
  };
}

// ---------------------------------------------------------------------------
// Sentencias (las mismas que se ejecutan en modo real y se loguean en simulación).
// Su forma exacta la exige la lista blanca de db-bdav-escritura.ts.
// ---------------------------------------------------------------------------

export const SQL_FOLIO_BKO =
  "SELECT id, folio_bko FROM folios_ventas WHERE folio_bko IS NOT NULL ORDER BY id LIMIT 1 FOR UPDATE";
export const SQL_TOMAR_FOLIO_BKO = "UPDATE folios_ventas SET folio_bko = folio_bko + 1 WHERE id = ? AND folio_bko = ?";
export const SQL_CANCELAR_BKO = "UPDATE back_order SET estatus = ? WHERE id = ?";
/** Solo lectura y fuera de transacción: el número que le tocaría, para el log de la simulación. */
const SQL_FOLIO_BKO_ESTIMADO = "SELECT folio_bko FROM folios_ventas WHERE folio_bko IS NOT NULL ORDER BY id LIMIT 1";

/** INSERT de la cabecera. `numBko` admite un texto solo para el log de la simulación. */
export function sentenciaCabeceraBko(numBko: number | string, cabecera: CabeceraBackorderPos): SentenciaPos {
  return {
    sql: `INSERT INTO back_order (id_prov, id_cte, id_vendedor, num_bko, fecha_bko, nombre_cliente, telefono, email, subtotal, iva, total, anticipo, liquida, saldo, estatus, fecha_compromiso, comentarios)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      cabecera.idProv,
      cabecera.idCte,
      cabecera.idVendedor,
      numBko,
      cabecera.fechaBko,
      cabecera.nombreCliente,
      cabecera.telefono,
      cabecera.email,
      cabecera.subtotal,
      cabecera.iva,
      cabecera.total,
      cabecera.anticipo,
      cabecera.liquida,
      cabecera.saldo,
      cabecera.estatus,
      cabecera.fechaCompromiso,
      cabecera.comentarios,
    ],
  };
}

/** INSERT de un renglón. `idBko` es el insertId de la cabecera (o un texto en el log de la simulación). */
export function sentenciaRenglonBko(idBko: number | string, renglon: RenglonBackorderPos): SentenciaPos {
  return {
    sql: `INSERT INTO detalle_bko (id_bko, id_art, partida, cantidad, precio, total_part, estatus, cant_recibida, fecha_llegada)
   VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
    params: [idBko, renglon.idArt, renglon.partida, renglon.cantidad, renglon.precio, renglon.totalPart, renglon.estatus],
  };
}

const cifra = new Intl.NumberFormat("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function contar(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/** Texto para la pantalla cuando se corre en simulación: qué se habría insertado. */
export function resumirSimulacionBko(backorder: BackorderPos, numBkoEstimado: number | string): string {
  const { cabecera, renglones, omitidas } = backorder;
  const base =
    `Simulada (no se escribió en el POS): ${contar(renglones.length, "renglón", "renglones")}, ` +
    `id_cte ${cabecera.idCte}, vendedor ${cabecera.idVendedor}, num_bko estimado ${numBkoEstimado}, ` +
    `compromiso ${cabecera.fechaCompromiso}, subtotal ${cabecera.subtotal.toFixed(2)}, ` +
    `IVA ${cabecera.iva.toFixed(2)}, total ${cabecera.total.toFixed(2)}`;
  const extra = omitidas.length > 0 ? `; ${contar(omitidas.length, "omitida", "omitidas")}` : "";
  return (base + extra).slice(0, ERROR_MAX);
}

/** 'Back order 71 en el POS: 2 renglones, total 1,709.84, compromiso VIERNES' (+ las omitidas). */
export function detalleInsercionBko(numBko: number, backorder: BackorderPos): string {
  const { cabecera, renglones, omitidas } = backorder;
  const extra = omitidas.length > 0 ? ` (${contar(omitidas.length, "omitida", "omitidas")}: ${omitidas.join(", ")})` : "";
  return (
    `Back order ${numBko} en el POS: ${contar(renglones.length, "renglón", "renglones")}, ` +
    `total ${cifra.format(cabecera.total)}, compromiso ${cabecera.fechaCompromiso}${extra}`
  );
}

// ---------------------------------------------------------------------------
// Con base.
// ---------------------------------------------------------------------------

/** vendedores.id con el que firma `usuario`: el de vendedores_pos o el por defecto. */
export async function idVendedorDe(usuario: string | null): Promise<number> {
  const enTabla = usuario ? await leerIdVendedorPos(usuario) : null;
  return enTabla ?? idVendedorDefault();
}

/** El folio que leímos ya lo subió el POS en el mismo instante. */
class FolioBkoOcupadoError extends Error {
  readonly numBko: number;

  constructor(numBko: number) {
    super(`folio_bko ${numBko} ya lo tomó el POS`);
    this.name = "FolioBkoOcupadoError";
    this.numBko = numBko;
  }
}

interface InsercionBko {
  idBko: number;
  numBko: number;
}

/**
 * Inserta la back order en bdav en una transacción: lee el folio bajo FOR
 * UPDATE, lo sube con el UPDATE optimista, inserta cabecera y renglones. Si
 * el folio ya no era el leído (el POS lo subió sin candado), deshace y vuelve
 * a empezar, hasta INTENTOS_FOLIO_BKO veces.
 */
async function insertarEnPos(backorder: BackorderPos): Promise<InsercionBko> {
  for (let intento = 1; ; intento++) {
    try {
      return await enTransaccionPos(async (ejecutar) => {
        const filas = (await ejecutar(SQL_FOLIO_BKO)) as Array<{ id: number; folio_bko: number }>;
        if (filas.length === 0) throw new Error("folios_ventas no tiene ninguna fila con folio_bko");
        const idFolio = Number(filas[0].id);
        const numBko = Number(filas[0].folio_bko);

        const tomado = (await ejecutar(SQL_TOMAR_FOLIO_BKO, [idFolio, numBko])) as { affectedRows: number };
        if (Number(tomado.affectedRows) !== 1) throw new FolioBkoOcupadoError(numBko);

        const cabecera = sentenciaCabeceraBko(numBko, backorder.cabecera);
        const insertada = (await ejecutar(cabecera.sql, cabecera.params)) as { insertId: number };
        for (const renglon of backorder.renglones) {
          const sentencia = sentenciaRenglonBko(insertada.insertId, renglon);
          await ejecutar(sentencia.sql, sentencia.params);
        }
        return { idBko: insertada.insertId, numBko };
      });
    } catch (error) {
      if (!(error instanceof FolioBkoOcupadoError) || intento >= INTENTOS_FOLIO_BKO) throw error;
      console.warn(`[pos-backorder] ${error.message}; reintento ${intento + 1}/${INTENTOS_FOLIO_BKO}`);
    }
  }
}

async function cancelarEnPos(idBko: number): Promise<void> {
  await enTransaccionPos(async (ejecutar) => {
    await ejecutar(SQL_CANCELAR_BKO, [ESTATUS_CANCELADA, idBko]);
  });
}

/** Número que le tocaría a la back order, solo para que el log de la simulación sea creíble. */
async function numBkoEstimado(): Promise<number | string> {
  try {
    const filas = await consultaBdav<{ folio_bko: number }>(SQL_FOLIO_BKO_ESTIMADO);
    return filas.length > 0 ? Number(filas[0].folio_bko) : "?";
  } catch (error) {
    console.warn("[pos-backorder] no se pudo leer folio_bko para la simulación:", error);
    return "?";
  }
}

function mensajeDe(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, ERROR_MAX);
}

/** Hay una back order vigente (real o simulada) que hay que respetar o cancelar. */
function esVigente(guardada: BackorderPosGuardada): boolean {
  return guardada.estado === "insertada" || guardada.estado === "simulada";
}

/** La firma se guarda acotada a la columna: se compara con el mismo recorte. */
function mismaFirma(guardada: string | null, actual: string): boolean {
  return guardada !== null && guardada === actual.slice(0, BKO_FIRMA_MAX);
}

/** Referencia a la back order del POS que hay que conservar en un error para poder cancelarla después. */
type ReferenciaBko = Pick<BackorderPosGuardada, "numBkoPos" | "idBkoPos">;

function guardarError(
  idPedido: number,
  mensaje: string,
  usuario: string | null,
  conserva: ReferenciaBko | null
): Promise<PedidoDetalle> {
  const error = mensaje.slice(0, ERROR_MAX);
  return guardarBackorderPos(
    idPedido,
    {
      estado: "error",
      numBkoPos: conserva?.numBkoPos ?? null,
      idBkoPos: conserva?.idBkoPos ?? null,
      firma: null,
      compromiso: null,
      error,
      evento: "backorder_pos_error",
      detalle: error,
    },
    usuario
  );
}

async function simular(
  idPedido: number,
  pedido: PedidoDetalle,
  backorder: BackorderPos,
  firma: string,
  usuario: string | null
): Promise<PedidoDetalle> {
  const estimado = await numBkoEstimado();
  const sentencias = [
    sentenciaCabeceraBko(`${estimado} (estimado, folios_ventas.folio_bko)`, backorder.cabecera),
    ...backorder.renglones.map((r) => sentenciaRenglonBko("<insertId de la cabecera>", r)),
  ];
  console.info("[pos-backorder] simulación (no se escribe en bdav)", {
    pedido: folioDe(pedido),
    cabecera: backorder.cabecera,
    renglones: backorder.renglones,
    omitidas: backorder.omitidas,
    sentencias,
  });
  const resumen = resumirSimulacionBko(backorder, estimado);
  return guardarBackorderPos(
    idPedido,
    {
      estado: "simulada",
      numBkoPos: null,
      idBkoPos: null,
      firma,
      compromiso: backorder.cabecera.fechaCompromiso,
      error: resumen,
      evento: "backorder_pos_simulada",
      detalle: resumen,
    },
    usuario
  );
}

/**
 * La back order vigente pasa a CANCELADA: en el POS si está insertada (modo
 * real; en simulación solo se loguea), solo en el pedido si es simulada. Con
 * el módulo apagado no se toca el POS y se devuelve null. Un fallo al cancelar
 * en el POS se anota en el pedido (sigue insertada, con el error) y no sube.
 */
async function cancelarVigente(
  idPedido: number,
  guardada: BackorderPosGuardada,
  usuario: string | null,
  porQue: string
): Promise<PedidoDetalle | null> {
  if (guardada.estado === "simulada" || guardada.idBkoPos === null) {
    console.info(`[pos-backorder] se cancela la back order simulada del pedido ${idPedido}: ${porQue}`);
    return guardarBackorderPos(
      idPedido,
      {
        estado: "cancelada",
        numBkoPos: guardada.numBkoPos,
        idBkoPos: guardada.idBkoPos,
        firma: guardada.firma,
        compromiso: guardada.compromiso,
        error: null,
        evento: "backorder_pos_cancelada",
        detalle: `Back order simulada cancelada (no había nada en el POS): ${porQue}`,
      },
      usuario
    );
  }

  const modo = modoActual();
  if (modo === "apagado") {
    console.warn(
      `[pos-backorder] módulo apagado: la back order ${guardada.numBkoPos} del pedido ${idPedido} sigue ABIERTA en el POS`
    );
    return null;
  }

  const cancelada: ResultadoBkoPos = {
    estado: "cancelada",
    numBkoPos: guardada.numBkoPos,
    idBkoPos: guardada.idBkoPos,
    firma: guardada.firma,
    compromiso: guardada.compromiso,
    error: null,
    evento: "backorder_pos_cancelada",
    detalle: `Back order ${guardada.numBkoPos} cancelada en el POS${modo === "simulacion" ? " (simulación)" : ""}: ${porQue}`,
  };
  try {
    if (modo === "real") {
      await cancelarEnPos(guardada.idBkoPos);
    } else {
      console.info("[pos-backorder] simulación de cancelación (no se escribe en bdav)", {
        sql: SQL_CANCELAR_BKO,
        params: [ESTATUS_CANCELADA, guardada.idBkoPos],
      });
    }
    return await guardarBackorderPos(idPedido, cancelada, usuario);
  } catch (error) {
    console.error(`[pos-backorder] cancelando la back order ${guardada.numBkoPos} del pedido ${idPedido}:`, error);
    return guardarBackorderPos(
      idPedido,
      {
        estado: guardada.estado,
        numBkoPos: guardada.numBkoPos,
        idBkoPos: guardada.idBkoPos,
        firma: guardada.firma,
        compromiso: guardada.compromiso,
        error: `No se pudo cancelar en el POS: ${mensajeDe(error)}`.slice(0, ERROR_MAX),
        evento: "backorder_pos_error",
        detalle: `No se pudo cancelar la back order ${guardada.numBkoPos} en el POS: ${mensajeDe(error)}`,
      },
      usuario
    );
  }
}

/** Ya no hay partidas sobre pedido: la vigente se cancela; si nunca hubo, queda omitida (no es error). */
async function sinRenglones(
  idPedido: number,
  pedido: PedidoDetalle,
  guardada: BackorderPosGuardada,
  usuario: string | null
): Promise<PedidoDetalle> {
  if (esVigente(guardada)) {
    return (await cancelarVigente(idPedido, guardada, usuario, "ya no hay partidas sobre pedido")) ?? pedido;
  }
  const yaAnotado =
    guardada.estado === "cancelada" || (guardada.estado === "omitida" && guardada.error === MOTIVO_SIN_PARTIDAS);
  if (yaAnotado) return pedido;
  return guardarBackorderPos(
    idPedido,
    {
      estado: "omitida",
      numBkoPos: null,
      idBkoPos: null,
      firma: null,
      compromiso: null,
      error: MOTIVO_SIN_PARTIDAS,
      evento: "backorder_pos_omitida",
      detalle: MOTIVO_SIN_PARTIDAS,
    },
    usuario
  );
}

/** Módulo apagado: no se toca el POS. Una insertada real se deja como está (no se puede cancelar). */
async function apagado(
  idPedido: number,
  pedido: PedidoDetalle,
  guardada: BackorderPosGuardada,
  usuario: string | null
): Promise<PedidoDetalle> {
  if (guardada.estado === "insertada") {
    console.warn(
      `[pos-backorder] módulo apagado: la back order ${guardada.numBkoPos} del pedido ${idPedido} sigue ABIERTA en el POS y los renglones cambiaron`
    );
    return pedido;
  }
  if (guardada.estado === "omitida" && guardada.error === MOTIVO_APAGADO) return pedido;
  return guardarBackorderPos(
    idPedido,
    {
      estado: "omitida",
      numBkoPos: null,
      idBkoPos: null,
      firma: null,
      compromiso: null,
      error: MOTIVO_APAGADO,
      evento: "backorder_pos_omitida",
      detalle: `Back order en el POS apagada (${MOTIVO_APAGADO})`,
    },
    usuario
  );
}

/**
 * Pide (o vuelve a pedir) a Aldo las partidas sobre pedido del pedido según
 * POS_BKO_MODO y deja en el pedido cómo quedó (bkoPosEstado, numBkoPos,
 * bkoPosError, bkoPosCompromiso). Idempotente: si la back order vigente tiene
 * la misma firma de renglones, no hace nada; si cambió, cancela la anterior en
 * el POS y pide otra; si ya no hay renglones, cancela y queda 'cancelada' (u
 * 'omitida' si nunca hubo). Ningún error del POS sube: se guarda como estado
 * `error` con su mensaje y el pedido se devuelve igual, para que el cambio de
 * estatus que lo disparó nunca se rompa por esto. Solo se propaga que el
 * pedido no exista o que la propia base de pedidos falle.
 */
export async function sincronizarBackorderPos(idPedido: number, usuario: string | null): Promise<PedidoDetalle> {
  const pedido = await obtenerPedido(idPedido);
  if (!pedido) throw new PedidoNoEncontradoError();
  if (!puedeTenerBackorder(pedido.estatus)) return pedido;

  const guardada = await leerBackorderPos(idPedido);
  if (!guardada) throw new PedidoNoEncontradoError();
  const renglones = partidasParaBackorder(pedido.partidas);
  const firma = firmaBackorder(renglones);

  if (esVigente(guardada) && mismaFirma(guardada.firma, firma)) return pedido;
  if (renglones.length === 0) return sinRenglones(idPedido, pedido, guardada, usuario);

  const modo = modoActual();
  if (modo === "apagado") return apagado(idPedido, pedido, guardada, usuario);

  // La back order que sigue viva en el POS (insertada, o un error que no la
  // alcanzó a cancelar): se conserva su referencia hasta que se cancele, para
  // que un fallo a medio camino no la deje huérfana.
  let anterior: ReferenciaBko | null =
    guardada.idBkoPos !== null && guardada.estado !== "cancelada"
      ? { numBkoPos: guardada.numBkoPos, idBkoPos: guardada.idBkoPos }
      : null;

  try {
    const [idClienteBdav, idVendedor, idArticuloPorPartida] = await Promise.all([
      idClienteBdavDe(pedido.idCliente),
      idVendedorDe(usuario),
      idArticuloPorPartidaDe(renglones),
    ]);
    const { fecha } = ahoraMonterrey();
    const armado = armarBackorderPos(pedido, {
      idClienteBdav,
      idVendedor,
      fechaBko: fecha,
      fechaCompromiso: fechaCompromisoAldo(fecha),
      idArticuloPorPartida,
    });
    if (!armado.ok) return await guardarError(idPedido, armado.error, usuario, anterior);

    if (modo === "simulacion") {
      if (anterior) {
        console.warn(
          `[pos-backorder] simulación: la back order ${anterior.numBkoPos} del pedido ${idPedido} sigue ABIERTA en el POS`
        );
      }
      return await simular(idPedido, pedido, armado.backorder, firma, usuario);
    }

    if (anterior?.idBkoPos) {
      await cancelarEnPos(anterior.idBkoPos);
      console.info(`[pos-backorder] back order ${anterior.numBkoPos} del pedido ${idPedido} cancelada en el POS: cambiaron los renglones`);
    }
    const reemplaza = anterior ? ` · reemplaza a la ${anterior.numBkoPos}, cancelada` : "";
    anterior = null;

    const insercion = await insertarEnPos(armado.backorder);
    return await guardarBackorderPos(
      idPedido,
      {
        estado: "insertada",
        numBkoPos: insercion.numBko,
        idBkoPos: insercion.idBko,
        firma,
        compromiso: armado.backorder.cabecera.fechaCompromiso,
        error: null,
        evento: "backorder_pos",
        detalle: detalleInsercionBko(insercion.numBko, armado.backorder) + reemplaza,
      },
      usuario
    );
  } catch (error) {
    console.error(`[pos-backorder] pidiendo a Aldo la back order del pedido ${folioDe(pedido)}:`, error);
    return guardarError(idPedido, mensajeDe(error), usuario, anterior);
  }
}

/**
 * Al cancelar el pedido, su back order vigente pasa a CANCELADA en el POS
 * (modo real) o se loguea (simulación); una simulada solo cambia de estado. Si
 * no hay nada vigente (pendiente, omitida, error, ya cancelada) no hace nada.
 */
export async function cancelarBackorderPos(idPedido: number, usuario: string | null): Promise<void> {
  const guardada = await leerBackorderPos(idPedido);
  if (!guardada) throw new PedidoNoEncontradoError();
  if (!esVigente(guardada)) return;
  await cancelarVigente(idPedido, guardada, usuario, "pedido cancelado");
}
