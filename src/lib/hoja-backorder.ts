import { consultaBdav } from "@/lib/db";
import { ahoraMonterrey } from "@/lib/db-conversaciones";
import { leerBackorderPos } from "@/lib/db-pedidos";
import {
  fechaCompromisoAldo,
  redondear2,
  renglonesParaBackorder,
  type EstadoBkoPos,
  type PedidoDetalle,
} from "@/lib/pedidos";
import {
  ID_PROV_ALDO,
  existenciasParaBackorder,
  idVendedorDe,
  precioSinIvaBko,
  totalesBko,
} from "@/lib/pos-backorder";

// Hoja de la back order a Aldo: la orden de compra que el mostrador imprime
// para el proveedor. Lleva los renglones que se le piden a Aldo tal como se
// piden (precio sin IVA, IVA en el total), aunque la back order todavía no
// exista en el POS (pendiente, error, simulada): la hoja sirve igual para
// pedir por teléfono. Qué va y cuántas piezas se decide con la misma regla y
// la misma lectura de existencia que usa la inserción en el POS
// (renglonesParaBackorder), para que la hoja y el POS digan lo mismo: de un
// renglón del que se piden 3 y hay 1 en tienda, van 2. El proveedor y el nombre del vendedor se leen de bdav
// (solo lectura) y degradan a null si bdav no responde.

export interface RenglonBackorderHoja {
  /** Renglón 1..n de la back order (mismo orden que en el POS). */
  partida: number;
  codigo: string;
  descripcion: string;
  /** Piezas que van a Aldo: el faltante cuando en tienda ya hay algunas. */
  cantidad: number;
  /** Piezas que pidió el cliente; si difiere de `cantidad`, la hoja dice "2 de 3". */
  cantidadPedida: number;
  precioSinIva: number;
  /** cantidad (la que va a Aldo) × precioSinIva. */
  importeSinIva: number;
  /** Días que prometió el mostrador al marcarla sobre pedido; null si no dijo. */
  diasEntrega: number | null;
}

export interface HojaBackorder {
  pedido: PedidoDetalle;
  backorder: {
    /** num_bko en el POS; null mientras no esté insertada. */
    numBko: number | null;
    estado: EstadoBkoPos;
    error: string | null;
    /** 'AAAA-MM-DD' en que se pidió (o simuló); null si todavía no. */
    fechaBko: string | null;
    /** MARTES | VIERNES con el que se pidió o, si no hay back order, el que le tocaría hoy. */
    fechaCompromiso: string | null;
    /** Nombre en `vendedores` del vendedor que firma (o firmaría); null si bdav no respondió. */
    vendedor: string | null;
    idVendedor: number | null;
  };
  /** ALDO AUTOPARTES según bdav.proveedores; null si bdav no respondió. */
  proveedor: { nombre: string; direccion: string; ciudad: string; telefono: string } | null;
  renglones: RenglonBackorderHoja[];
  totales: { subtotal: number; iva: number; total: number };
  generadoEn: string;
}

interface FilaProveedor {
  nombre: string;
  calle: string | null;
  numero: string | null;
  colonia: string | null;
  codpost: string | null;
  ciudad: string | null;
  estado: string | null;
  telefono: string | null;
}

const limpio = (valor: unknown): string => (valor == null ? "" : String(valor).trim());

async function proveedorAldo(): Promise<HojaBackorder["proveedor"]> {
  const filas = await consultaBdav<FilaProveedor>(
    `SELECT nombre, calle, numero, colonia, codpost, ciudad, estado, telefono
       FROM proveedores WHERE id = ? LIMIT 1`,
    [ID_PROV_ALDO]
  );
  if (filas.length === 0) {
    console.error(`[hoja-backorder] el proveedor ${ID_PROV_ALDO} (Aldo) no está en bdav.proveedores`);
    return null;
  }
  const fila = filas[0];
  const calleNumero = [limpio(fila.calle), limpio(fila.numero)].filter(Boolean).join(" ");
  const codpost = limpio(fila.codpost);
  return {
    nombre: limpio(fila.nombre),
    direccion: [calleNumero, limpio(fila.colonia), codpost ? `CP ${codpost}` : ""].filter(Boolean).join(", "),
    ciudad: [limpio(fila.ciudad), limpio(fila.estado)].filter(Boolean).join(", "),
    telefono: limpio(fila.telefono),
  };
}

async function nombreVendedor(idVendedor: number): Promise<string | null> {
  const filas = await consultaBdav<{ vendedor: string }>("SELECT vendedor FROM vendedores WHERE id = ? LIMIT 1", [
    idVendedor,
  ]);
  return filas.length > 0 ? limpio(filas[0].vendedor) : null;
}

/** bdav que no responde no deja al mostrador sin hoja: ese dato sale null y el fallo se loguea. */
async function oNulo<T>(consulta: Promise<T>, contexto: string): Promise<T | null> {
  try {
    return await consulta;
  } catch (error) {
    console.error(`[hoja-backorder] ${contexto}:`, error);
    return null;
  }
}

export async function armarHojaBackorder(pedido: PedidoDetalle): Promise<HojaBackorder> {
  // El vendedor que firma (o firmaría) es el último que atendió el pedido, que
  // es quien confirmó las partidas; antes de eso, quien lo capturó.
  const [guardada, idVendedor, existencias] = await Promise.all([
    leerBackorderPos(pedido.id),
    idVendedorDe(pedido.atendidoPor ?? pedido.capturadoPor),
    existenciasParaBackorder(pedido.partidas),
  ]);
  const [proveedor, vendedor] = await Promise.all([
    oNulo(proveedorAldo(), "leyendo el proveedor Aldo en bdav"),
    oNulo(nombreVendedor(idVendedor), `leyendo el vendedor ${idVendedor} en bdav`),
  ]);

  const piezasParaAldo = new Map(
    renglonesParaBackorder(pedido.partidas, existencias).map((r) => [r.partida, r.cantidad])
  );
  const renglones: RenglonBackorderHoja[] = [];
  for (const partida of pedido.partidas) {
    const cantidad = piezasParaAldo.get(partida.partida);
    if (cantidad === undefined) continue;
    const precioSinIva = precioSinIvaBko(partida.precioUnitario);
    renglones.push({
      partida: renglones.length + 1,
      codigo: partida.codigo ?? "",
      descripcion: partida.descripcion,
      cantidad,
      cantidadPedida: partida.cantidad,
      precioSinIva,
      importeSinIva: redondear2(cantidad * precioSinIva),
      diasEntrega: partida.diasEntrega,
    });
  }

  const { fecha, momento } = ahoraMonterrey();
  return {
    pedido,
    backorder: {
      numBko: pedido.numBkoPos,
      estado: pedido.bkoPosEstado,
      error: pedido.bkoPosError,
      fechaBko: guardada?.en ? guardada.en.slice(0, 10) : null,
      fechaCompromiso: pedido.bkoPosCompromiso ?? fechaCompromisoAldo(fecha),
      vendedor,
      idVendedor,
    },
    proveedor,
    renglones,
    totales: totalesBko(renglones.map((r) => r.importeSinIva)),
    generadoEn: momento,
  };
}
