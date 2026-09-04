// Precio y existencia de lo que entra a un pedido de mostrador.
//
// La regla de precio es UNA sola, la misma con la que Vico cotiza en
// `buscar_productos` (vendedor.ts): si el pedido cantara un precio distinto al
// del chat, el cliente lo notaría en el mostrador. Si se cambia la fórmula
// allá, hay que cambiarla aquí (y al revés).
//
// Solo lectura: bdav y la Bodega Usado se consultan por consultaBdav /
// consultaUsadas; nada de aquí escribe en ninguna base.

import { consultaBdav } from "@/lib/db";
import { consultaUsadas } from "@/lib/db-usadas";
import { condicionesPorPalabra, expresionRelevancia } from "@/lib/busqueda";
import type { OrigenPartida } from "@/lib/pedidos";

// Tope del buscador manual de /mostrador/nuevo: es una lista para elegir a
// mano, no un catálogo.
export const LIMITE_BUSQUEDA_ARTICULOS = 20;

/** Multiplicador de IVA con el que se publican todos los precios. */
const IVA = 1.16;

export interface ArticuloParaPedido {
  codigo: string;
  descripcion: string;
  existencia: number;
  precioConIva: number;
  precioSinIva: number;
  marca: string;
  tipoParte: string;
}

export interface PiezaUsadaParaPedido {
  idPieza: number;
  descripcion: string;
  existencia: number;
  precioConIva: number;
  precioSinIva: number;
  marca: string;
  modelo: string;
}

/**
 * Descuento del padrón que se puede aplicar, o `null` para cotizar de
 * mostrador. El porcentaje va interpolado en el SQL (no se puede parametrizar
 * dentro de una expresión aritmética con este driver), así que antes se exige
 * que sea un número finito entre 0 y 100; cualquier otra cosa cotiza de
 * mostrador. Mismo criterio que `buscarProductos` en vendedor.ts.
 */
export function normalizarDescuento(descuentoCliente: number | null | undefined): number | null {
  return descuentoCliente !== null &&
    descuentoCliente !== undefined &&
    Number.isFinite(descuentoCliente) &&
    descuentoCliente >= 0 &&
    descuentoCliente < 100
    ? descuentoCliente
    : null;
}

/**
 * Factor por el que se multiplica el precio de lista para aplicar el
 * descuento D: 15 → 0.85. Se calcula igual que en vendedor.ts para que los
 * centavos del redondeo coincidan.
 */
export function factorDescuento(descuento: number): number {
  return (100 - descuento) / 100;
}

/**
 * Expresión SQL del precio SIN IVA de un artículo de bdav (alias `a`).
 *
 * Sin descuento se cotiza precio_vta (el de mostrador, que ya trae el 33% que
 * llevan todos los artículos). Con descuento del padrón se recalcula desde el
 * precio de lista; cuando el descuento del cliente es el mismo del artículo se
 * usa precio_vta tal cual, porque es ese mismo cálculo pero ya redondeado como
 * lo hace el punto de venta, y así el pedido no canta 50 centavos distintos.
 *
 * `descuento` debe venir ya normalizado (`normalizarDescuento`): aquí se
 * interpola en el SQL sin más validación.
 */
export function sqlPrecioBase(descuento: number | null): string {
  if (descuento === null) return "IFNULL(a.precio_vta, 0)";
  return `CASE WHEN a.descuento = ${descuento} THEN IFNULL(a.precio_vta, 0)
              ELSE ROUND(IFNULL(a.precio_lista, 0) * ${factorDescuento(descuento)}, 2) END`;
}

/**
 * Condición SQL de "tiene precio con el que se puede pedir". Sin descuento
 * del padrón basta cualquier precio (lista o mostrador): así el pedido acepta
 * todo lo que Vico cotiza en `buscar_productos`, que no filtra por precio de
 * lista y hay artículos con precio_vta pero precio_lista en cero. Con
 * descuento el precio se recalcula desde la lista, y sin ella no hay de dónde.
 */
export function sqlFiltroPrecio(descuento: number | null): string {
  if (descuento === null) return "(IFNULL(a.precio_lista, 0) > 0 OR IFNULL(a.precio_vta, 0) > 0)";
  return "IFNULL(a.precio_lista, 0) > 0";
}

/** Las columnas de precio y existencia que comparten las consultas a bdav. */
function columnasArticulo(descuento: number | null): string {
  const precioBase = sqlPrecioBase(descuento);
  return `a.codigo, a.descripcion,
          IFNULL(l.linea, '') AS marca, IFNULL(p.parte, '') AS tipoParte,
          ${precioBase} AS precioSinIva,
          ROUND((${precioBase}) * ${IVA}, 2) AS precioConIva,
          IFNULL(a.existencia, 0) AS existencia`;
}

interface FilaArticulo {
  codigo: string;
  descripcion: string;
  marca: string;
  tipoParte: string;
  precioSinIva: number;
  precioConIva: number;
  existencia: number;
}

function articuloDeFila(fila: FilaArticulo): ArticuloParaPedido {
  return {
    codigo: String(fila.codigo),
    descripcion: String(fila.descripcion ?? ""),
    existencia: Number(fila.existencia) || 0,
    precioConIva: Number(fila.precioConIva) || 0,
    precioSinIva: Number(fila.precioSinIva) || 0,
    marca: String(fila.marca ?? ""),
    tipoParte: String(fila.tipoParte ?? ""),
  };
}

/**
 * Un artículo de bdav por código exacto, con el precio que le toca al cliente.
 * `null` si no existe o no tiene precio con el que pedirlo (`sqlFiltroPrecio`;
 * `motivoSinArticulo` distingue los dos casos). La colación de bdav no
 * distingue mayúsculas, así que "fac123" y "FAC123" son el mismo código; y
 * como hay códigos capturados dos veces, se queda la fila con más existencia
 * y, a empate, la más antigua.
 */
export async function articuloParaPedido(
  codigo: string,
  descuentoCliente: number | null
): Promise<ArticuloParaPedido | null> {
  const codigoLimpio = codigo.trim();
  if (!codigoLimpio) return null;
  const descuento = normalizarDescuento(descuentoCliente);

  const filas = await consultaBdav<FilaArticulo>(
    `SELECT ${columnasArticulo(descuento)}
       FROM articulos a
       LEFT JOIN lineas l ON l.id = a.id_linea
       LEFT JOIN partes p ON p.id = a.id_parte
      WHERE a.codigo = ? AND ${sqlFiltroPrecio(descuento)}
      ORDER BY IFNULL(a.existencia, 0) DESC, a.id ASC
      LIMIT 1`,
    [codigoLimpio]
  );
  return filas.length > 0 ? articuloDeFila(filas[0]) : null;
}

export type MotivoSinArticulo = "no_existe" | "sin_precio_lista";

/**
 * Por qué `articuloParaPedido` no devolvió nada, para que el error al usuario
 * no diga "no encontré el código" cuando el código sí está pero no tiene
 * precio de lista para aplicarle el descuento del padrón. Solo se llama en el
 * camino del error, así que la consulta extra no pesa.
 */
export async function motivoSinArticulo(
  codigo: string,
  descuentoCliente: number | null
): Promise<MotivoSinArticulo> {
  if (normalizarDescuento(descuentoCliente) === null) return "no_existe";
  const deMostrador = await articuloParaPedido(codigo, null);
  return deMostrador ? "sin_precio_lista" : "no_existe";
}

interface FilaPiezaUsada {
  idPieza: number;
  descripcion: string;
  marca: string;
  modelo: string;
  precioSinIva: number;
  precioConIva: number;
  existencia: number;
}

/**
 * Una pieza de la Bodega Usado por id, solo si sigue en existencia. El precio
 * de la Bodega viene sin IVA y no lleva descuento de padrón: las usadas se
 * venden al precio que marca la bodega.
 */
export async function piezaUsadaParaPedido(idPieza: number): Promise<PiezaUsadaParaPedido | null> {
  if (!Number.isInteger(idPieza) || idPieza <= 0) return null;

  const filas = await consultaUsadas<FilaPiezaUsada>(
    `SELECT p.id_pieza AS idPieza, p.descripcion,
            IFNULL(ma.marca, '') AS marca, IFNULL(mo.modelo, '') AS modelo,
            IFNULL(p.precio, 0) AS precioSinIva,
            ROUND(IFNULL(p.precio, 0) * ${IVA}, 2) AS precioConIva,
            IFNULL(p.existencia, 0) AS existencia
       FROM piezas p
       LEFT JOIN partes pa ON pa.id_parte = p.id_parte
       LEFT JOIN modelos mo ON mo.id_modelo = p.id_modelo
       LEFT JOIN marcas ma ON ma.id_marca = mo.id_marca
      WHERE p.id_pieza = ? AND p.existencia > 0
      LIMIT 1`,
    [idPieza]
  );
  if (filas.length === 0) return null;
  const fila = filas[0];
  return {
    idPieza: Number(fila.idPieza),
    descripcion: String(fila.descripcion ?? ""),
    existencia: Number(fila.existencia) || 0,
    precioConIva: Number(fila.precioConIva) || 0,
    precioSinIva: Number(fila.precioSinIva) || 0,
    marca: String(fila.marca ?? ""),
    modelo: String(fila.modelo ?? ""),
  };
}

// Campos donde puede caer lo que teclea el vendedor en el buscador manual:
// descripción o código. Las palabras se expanden a sus sinónimos ("facia" →
// FASCIA) igual que en el chat, para que el buscador encuentre lo mismo que Vico.
const CAMPOS_BUSQUEDA = ["a.descripcion", "a.codigo"];

/**
 * Buscador manual de /mostrador/nuevo: artículos cuya descripción o código
 * contienen cada palabra del texto, con el precio del cliente. Solo artículos
 * con precio con el que se pueda pedir (`sqlFiltroPrecio`); primero los que
 * empiezan por la pieza pedida y los que tienen existencia.
 */
export async function buscarArticulosParaPedido(
  texto: string,
  descuentoCliente: number | null,
  limite: number = LIMITE_BUSQUEDA_ARTICULOS
): Promise<ArticuloParaPedido[]> {
  const frase = texto.trim();
  if (!frase) return [];
  const tope =
    Number.isInteger(limite) && limite > 0
      ? Math.min(limite, LIMITE_BUSQUEDA_ARTICULOS)
      : LIMITE_BUSQUEDA_ARTICULOS;

  const descuento = normalizarDescuento(descuentoCliente);
  const condiciones: string[] = [sqlFiltroPrecio(descuento)];
  const params: unknown[] = [];
  const palabras = condicionesPorPalabra(frase, CAMPOS_BUSQUEDA, condiciones, params);
  // Todas las palabras eran de posición (o sinónimos vacíos): no hay nada que buscar.
  if (palabras.requeridas.length === 0 && palabras.opcionales.length === 0) return [];

  const paramsOrden: unknown[] = [];
  const esLaPieza = expresionRelevancia(palabras.requeridas, ["a.descripcion"], paramsOrden, "empieza");
  const coincidePosicion = expresionRelevancia(palabras.opcionales, ["a.descripcion"], paramsOrden);

  // Se piden más filas de las que se devuelven porque los códigos duplicados
  // de bdav se depuran aquí (MySQL 5.7 no tiene ROW_NUMBER): entre dos filas
  // con el mismo código gana la de más existencia, luego la de menor id.
  const filas = await consultaBdav<FilaArticulo & { id: number }>(
    `SELECT a.id, ${columnasArticulo(descuento)}
       FROM articulos a
       LEFT JOIN lineas l ON l.id = a.id_linea
       LEFT JOIN partes p ON p.id = a.id_parte
      WHERE ${condiciones.join(" AND ")}
      ORDER BY ${esLaPieza} DESC, ${coincidePosicion} DESC,
               (IFNULL(a.existencia, 0) > 0) DESC, a.precio_vta ASC,
               IFNULL(a.existencia, 0) DESC, a.id ASC
      LIMIT ${tope * 2}`,
    [...params, ...paramsOrden]
  );

  return depurarDuplicados(filas).slice(0, tope).map(articuloDeFila);
}

/**
 * Deja una fila por código: la de mayor existencia y, a empate, la de menor
 * id, conservando la posición de la primera aparición de cada código en la
 * lista ordenada por relevancia.
 */
export function depurarDuplicados<T extends { codigo: string; existencia: number; id: number }>(
  filas: readonly T[]
): T[] {
  const mejorPorCodigo = new Map<string, T>();
  for (const fila of filas) {
    const clave = String(fila.codigo).toUpperCase();
    const actual = mejorPorCodigo.get(clave);
    if (!actual) {
      mejorPorCodigo.set(clave, fila);
      continue;
    }
    const gana =
      Number(fila.existencia) > Number(actual.existencia) ||
      (Number(fila.existencia) === Number(actual.existencia) && Number(fila.id) < Number(actual.id));
    if (gana) mejorPorCodigo.set(clave, fila);
  }
  return [...mejorPorCodigo.values()];
}

/** Lo que hace falta de un renglón del pedido para resolver su articulos.id. */
export type PartidaConCodigo = { partida: number; origen: OrigenPartida; codigo: string | null };

/**
 * articulos.id de cada renglón nuevo o sobre pedido, por número de partida
 * (las usadas no existen en bdav y se saltan). bdav tiene códigos capturados
 * dos veces: se elige la misma fila que cotizó articuloParaPedido (más
 * existencia y, a empate, menor id), para que lo que se escriba en el POS
 * (cotización, back order a Aldo) apunte al artículo cuyo precio se dio.
 */
export async function idArticuloPorPartidaDe(partidas: ReadonlyArray<PartidaConCodigo>): Promise<Map<number, number>> {
  const mapa = new Map<number, number>();
  const codigos = [
    ...new Set(
      partidas.filter((p) => p.origen !== "usada" && p.codigo).map((p) => (p.codigo as string).toUpperCase())
    ),
  ];
  if (codigos.length === 0) return mapa;

  const filas = await consultaBdav<{ id: number; codigo: string; existencia: number }>(
    "SELECT id, codigo, IFNULL(existencia, 0) AS existencia FROM articulos WHERE codigo IN (?)",
    [codigos]
  );
  const porCodigo = new Map(
    depurarDuplicados(
      filas.map((f) => ({ id: Number(f.id), codigo: String(f.codigo), existencia: Number(f.existencia) }))
    ).map((f) => [f.codigo.toUpperCase(), f.id])
  );
  for (const partida of partidas) {
    if (partida.origen === "usada" || !partida.codigo) continue;
    const id = porCodigo.get(partida.codigo.toUpperCase());
    if (id) mapa.set(partida.partida, id);
  }
  return mapa;
}
