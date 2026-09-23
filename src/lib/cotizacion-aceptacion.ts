import { SUCURSALES_ENTREGA, textoDomicilio, type Domicilio, type PedidoDetalle, type SucursalEntrega } from "./pedidos";

// La cotización que el cliente abre desde la liga del WhatsApp
// (`/cotizacion/[id]?c=…` en la página pública) y la firma con la que la
// acepta. Dos cosas puras: la VISTA que se le manda a la página —solo lo que
// el cliente tiene que ver para decidir: piezas, precios con IVA, dónde
// recoge; nada de teléfono, padrón, POS ni bitácora— y la validación de lo
// que manda de vuelta al firmar: su nombre y el trazo de la firma como PNG.

/** El trazo viene del lienzo de la página como data URL PNG; 200 KB sobran para una firma. */
export const FIRMA_MAX_BYTES = 200_000;
export const NOMBRE_ACEPTA_MIN = 3;
export const NOMBRE_ACEPTA_MAX = 150;
const ES_FIRMA_PNG = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/;

export interface Aceptacion {
  /** Quién firma, como lo tecleó. */
  nombre: string;
  /** data:image/png;base64,… */
  firma: string;
}

export type EstadoCotizacion = "cotizacion" | "pedido" | "cancelada";

export interface PartidaCotizacion {
  partida: number;
  codigo: string | null;
  descripcion: string;
  cantidad: number;
  /** IVA incluido. */
  precioUnitario: number;
  importe: number;
}

export interface VistaCotizacion {
  id: number;
  /** null mientras es cotización; el folio en cuanto se aceptó (ya es pedido). */
  folio: string | null;
  estado: EstadoCotizacion;
  cliente: string;
  sucursal: SucursalEntrega;
  sucursalNombre: string;
  domicilio: string | null;
  observaciones: string | null;
  partidas: PartidaCotizacion[];
  subtotal: number;
  iva: number;
  total: number;
  creadoEn: string;
  /** Quién y cuándo la aceptó; null si sigue abierta. */
  aceptacion: { nombre: string; en: string } | null;
}

function estadoDe(pedido: PedidoDetalle): EstadoCotizacion {
  if (pedido.estatus === "cancelado") return "cancelada";
  return pedido.estatus === "borrador" ? "cotizacion" : "pedido";
}

function nombreSucursal(clave: SucursalEntrega): string {
  return SUCURSALES_ENTREGA.find((s) => s.clave === clave)?.nombre ?? clave;
}

/** Lo que la página pública puede enseñar de un pedido como cotización. */
export function vistaCotizacion(pedido: PedidoDetalle): VistaCotizacion {
  return {
    id: pedido.id,
    folio: pedido.folio,
    estado: estadoDe(pedido),
    cliente: pedido.cliente,
    sucursal: pedido.sucursal,
    sucursalNombre: nombreSucursal(pedido.sucursal),
    domicilio: pedido.domicilio ? textoDomicilio(pedido.domicilio as Domicilio) : null,
    observaciones: pedido.observaciones,
    partidas: pedido.partidas.map((p) => ({
      partida: p.partida,
      codigo: p.codigo,
      descripcion: p.descripcion,
      cantidad: p.cantidad,
      precioUnitario: p.precioUnitario,
      importe: p.importe,
    })),
    subtotal: pedido.subtotal,
    iva: pedido.iva,
    total: pedido.total,
    creadoEn: pedido.creadoEn,
    aceptacion: pedido.aceptacion,
  };
}

type Validacion<T> = { ok: true; datos: T } | { ok: false; error: string };

function esObjeto(entrada: unknown): entrada is Record<string, unknown> {
  return !!entrada && typeof entrada === "object" && !Array.isArray(entrada);
}

/** Cuerpo de POST /api/pedidos/[id]/aceptar: `{ nombre, firma }`. */
export function validarAceptacion(entrada: unknown): Validacion<Aceptacion> {
  if (!esObjeto(entrada)) return { ok: false, error: "Petición inválida" };
  const nombre = typeof entrada.nombre === "string" ? entrada.nombre.replace(/\s+/g, " ").trim() : "";
  if (nombre.length < NOMBRE_ACEPTA_MIN || nombre.length > NOMBRE_ACEPTA_MAX) {
    return { ok: false, error: "Escribe tu nombre completo para firmar" };
  }
  const firma = typeof entrada.firma === "string" ? entrada.firma.trim() : "";
  if (!firma) return { ok: false, error: "Dibuja tu firma en el recuadro" };
  if (firma.length > FIRMA_MAX_BYTES || !ES_FIRMA_PNG.test(firma)) {
    return { ok: false, error: "La firma no se pudo leer; vuelve a dibujarla" };
  }
  return { ok: true, datos: { nombre, firma } };
}
