import { consultaBdav } from "@/lib/db";
import { ahoraMonterrey } from "@/lib/db-conversaciones";
import { consultaUsadas } from "@/lib/db-usadas";
import {
  SUCURSALES_ENTREGA,
  type EstatusPartida,
  type OrigenPartida,
  type PedidoDetalle,
  type SucursalEntrega,
} from "@/lib/pedidos";

// Hoja de surtido: lo que el almacén imprime para juntar las piezas de un
// pedido. La existencia se vuelve a leer en el momento (bdav para nuevas,
// Bodega Usado para usadas) porque la que se guardó en la partida es la de
// cuando se pidió, y entre una y otra pudo venderse en mostrador. Solo
// lectura: consultaBdav / consultaUsadas.

export interface RenglonSurtido {
  partida: number;
  origen: OrigenPartida;
  codigo: string | null;
  idPiezaUsada: number | null;
  descripcion: string;
  cantidad: number;
  estatusPartida: EstatusPartida;
  /** Existencia leída ahora mismo; null si la base no respondió. */
  existenciaActual: number | null;
  /** 'módulo / casillero' de la Bodega Usado; null en nuevas (bdav no tiene
   *  localización útil) o si la Bodega no respondió. */
  ubicacionUsada: string | null;
}

export interface HojaSurtido {
  pedido: PedidoDetalle;
  renglones: RenglonSurtido[];
  sucursal: { clave: SucursalEntrega; nombre: string };
  /** Las piezas viven en la matriz: si el cliente recoge en otra sucursal hay que moverlas. */
  trasladar: boolean;
  generadoEn: string;
}

/** Existencia por código en bdav. Hay códigos capturados dos veces: se toma la
 *  mayor, igual que al cotizar (articuloParaPedido). Claves en mayúsculas. */
async function existenciasNuevas(codigos: string[]): Promise<Map<string, number>> {
  const existencias = new Map<string, number>();
  if (codigos.length === 0) return existencias;
  const filas = await consultaBdav<{ codigo: string; existencia: number }>(
    `SELECT UPPER(a.codigo) AS codigo, MAX(IFNULL(a.existencia, 0)) AS existencia
       FROM articulos a
      WHERE a.codigo IN (?)
      GROUP BY UPPER(a.codigo)`,
    [codigos]
  );
  for (const fila of filas) existencias.set(String(fila.codigo).toUpperCase(), Number(fila.existencia) || 0);
  return existencias;
}

interface PiezaEnBodega {
  existencia: number;
  ubicacion: string | null;
}

/** Existencia y ubicación física ('módulo / casillero') por pieza en la Bodega Usado. */
async function existenciasUsadas(ids: number[]): Promise<Map<number, PiezaEnBodega>> {
  const piezas = new Map<number, PiezaEnBodega>();
  if (ids.length === 0) return piezas;
  const filas = await consultaUsadas<{ idPieza: number; existencia: number; ubicacion: string | null }>(
    `SELECT p.id_pieza AS idPieza,
            IFNULL(p.existencia, 0) AS existencia,
            CONCAT_WS(' / ', md.modulo, u.casillero) AS ubicacion
       FROM piezas p
       LEFT JOIN ubicaciones u ON u.id_ubicacion = p.id_ubicacion
       LEFT JOIN modulos md ON md.id_modulo = u.id_modulo
      WHERE p.id_pieza IN (?)`,
    [ids]
  );
  for (const fila of filas) {
    piezas.set(Number(fila.idPieza), {
      existencia: Number(fila.existencia) || 0,
      ubicacion: fila.ubicacion ? String(fila.ubicacion) : null,
    });
  }
  return piezas;
}

/**
 * Una base que no responde no deja al almacén sin hoja: esos renglones salen
 * con existencia null (la pantalla lo muestra como "sin dato") y el fallo se
 * loguea, que es lo que delata el problema.
 */
async function oVacio<T>(consulta: Promise<T>, contexto: string): Promise<T | null> {
  try {
    return await consulta;
  } catch (error) {
    console.error(`[hoja-surtido] ${contexto}:`, error);
    return null;
  }
}

export async function armarHojaSurtido(pedido: PedidoDetalle): Promise<HojaSurtido> {
  const codigos = [...new Set(pedido.partidas.flatMap((p) => (p.codigo ? [p.codigo.toUpperCase()] : [])))];
  const idsUsadas = [...new Set(pedido.partidas.flatMap((p) => (p.idPiezaUsada !== null ? [p.idPiezaUsada] : [])))];

  const [nuevas, usadas] = await Promise.all([
    oVacio(existenciasNuevas(codigos), "existencias de bdav"),
    oVacio(existenciasUsadas(idsUsadas), "existencias de la Bodega Usado"),
  ]);

  const renglones: RenglonSurtido[] = pedido.partidas.map((partida) => {
    const enBodega = partida.idPiezaUsada !== null ? (usadas?.get(partida.idPiezaUsada) ?? null) : null;
    const existenciaNueva =
      partida.codigo !== null && nuevas ? (nuevas.get(partida.codigo.toUpperCase()) ?? 0) : null;
    return {
      partida: partida.partida,
      origen: partida.origen,
      codigo: partida.codigo,
      idPiezaUsada: partida.idPiezaUsada,
      descripcion: partida.descripcion,
      cantidad: partida.cantidad,
      estatusPartida: partida.estatusPartida,
      existenciaActual: partida.idPiezaUsada !== null ? (enBodega?.existencia ?? null) : existenciaNueva,
      ubicacionUsada: enBodega?.ubicacion ?? null,
    };
  });

  const sucursal = SUCURSALES_ENTREGA.find((s) => s.clave === pedido.sucursal) ?? SUCURSALES_ENTREGA[0];
  return {
    pedido,
    renglones,
    sucursal,
    trasladar: pedido.sucursal !== "matriz",
    generadoEn: ahoraMonterrey().momento,
  };
}
