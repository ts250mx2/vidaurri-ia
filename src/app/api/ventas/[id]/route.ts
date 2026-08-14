import { NextResponse } from "next/server";
import { consultaBdav } from "@/lib/db";
import { consultaUsadas } from "@/lib/db-usadas";
import { sesionActual } from "@/lib/auth";

export const dynamic = "force-dynamic";

interface VentaUsadas {
  id: number;
  numVenta: number;
  fecha: string;
  subtotal: number;
  iva: number;
  total: number;
  saldo: number;
  estatus: string | null;
  observa: string | null;
  cliente: string | null;
  telefonoCliente: string | null;
}

interface PartidaUsadas {
  cantidad: number;
  codigo: string;
  descripcion: string;
  precio: number;
  totalPartida: number;
  ubicacion: string | null;
}

async function detalleMatriz(idVenta: number) {
  try {
    const [encabezados, partidas, formasPago] = await Promise.all([
      consultaBdav(
        `SELECT v.id, v.num_venta AS numVenta, v.serie, v.fecha,
                IFNULL(v.subtotal, 0) AS subtotal, IFNULL(v.iva, 0) AS iva,
                IFNULL(v.total, 0) AS total, IFNULL(v.saldo, 0) AS saldo,
                v.estatus, v.num_cotiza AS numCotiza, v.observa,
                IFNULL(NULLIF(v.nombre, ''), c.nombre) AS cliente,
                c.rfc, c.telefono AS telefonoCliente, v.telefono AS telefonoVenta
           FROM ventas v
           JOIN clientes c ON c.id = v.id_cliente
          WHERE v.id = ?`,
        [idVenta]
      ),
      consultaBdav(
        `SELECT d.partida, d.cantidad, a.codigo, a.descripcion,
                IFNULL(d.precio, 0) AS precio, IFNULL(d.total_partida, 0) AS totalPartida,
                d.devolucion, d.num_devol AS numDevol
           FROM detalle_venta d
           JOIN articulos a ON a.id = d.id_articulo
          WHERE d.id_venta = ?
          ORDER BY d.partida`,
        [idVenta]
      ),
      consultaBdav(
        `SELECT fp.describe_pago AS formaPago, u.nombre AS usuario
           FROM venta_formapago vf
           JOIN forma_pago fp ON fp.id = vf.id_formapago
           JOIN usuarios u    ON u.id = vf.id_usuario
          WHERE vf.id_venta = ?`,
        [idVenta]
      ),
    ]);

    const venta = encabezados[0];
    if (!venta) return NextResponse.json({ error: "Venta no encontrada" }, { status: 404 });

    // Nota: la base no liga devoluciones con la venta origen (detalle_venta.num_devol
    // nunca se llena y devoluciones no referencia la venta), por eso no se incluyen aquí.
    return NextResponse.json({ venta, partidas, formasPago });
  } catch (error) {
    console.error(`Error consultando venta ${idVenta}:`, error);
    return NextResponse.json(
      { error: "No fue posible consultar el detalle de la venta" },
      { status: 502 }
    );
  }
}

async function detalleUsadas(idVenta: number) {
  // La Bodega Usado no registra formas de pago ni vendedor; se devuelve el mismo
  // contrato que la matriz con esos campos vacíos/null para no romper el front.
  try {
    const [encabezados, filasPartidas] = await Promise.all([
      consultaUsadas<VentaUsadas>(
        `SELECT v.id_venta AS id, v.num_venta AS numVenta, v.fecha,
                IFNULL(v.subtotal, 0) AS subtotal, IFNULL(v.iva, 0) AS iva,
                IFNULL(v.total, 0) AS total, IFNULL(v.saldo, 0) AS saldo,
                v.estatus, v.observa,
                NULLIF(v.nombre_cliente, '') AS cliente,
                v.telefono_cliente AS telefonoCliente
           FROM ventas v
          WHERE v.id_venta = ?`,
        [idVenta]
      ),
      consultaUsadas<PartidaUsadas>(
        `SELECT d.cantidad, p.codigo, p.descripcion,
                IFNULL(d.precio, 0) AS precio, IFNULL(d.total_item, 0) AS totalPartida,
                NULLIF(CONCAT_WS(' / ', m.modulo, u.casillero), '') AS ubicacion
           FROM venta_detalle d
           JOIN piezas p        ON p.id_pieza = d.id_pieza
           LEFT JOIN ubicaciones u ON u.id_ubicacion = p.id_ubicacion
           LEFT JOIN modulos m     ON m.id_modulo = u.id_modulo
          WHERE d.id_venta = ?
          ORDER BY d.id_vta_detalle`,
        [idVenta]
      ),
    ]);

    const venta = encabezados[0];
    if (!venta) return NextResponse.json({ error: "Venta no encontrada" }, { status: 404 });

    return NextResponse.json({
      venta: { ...venta, serie: null, numCotiza: null, rfc: null, telefonoVenta: null },
      partidas: filasPartidas.map((p, indice) => ({
        partida: indice + 1,
        ...p,
        devolucion: null,
        numDevol: null,
      })),
      formasPago: [],
    });
  } catch (error) {
    console.error(`Error consultando venta ${idVenta} de la Bodega Usado:`, error);
    return NextResponse.json(
      { error: "No fue posible consultar la base de la Bodega Usado" },
      { status: 502 }
    );
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const sesion = await sesionActual();
  if (!sesion) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { id } = await params;
  const idVenta = Number(id);
  if (!Number.isInteger(idVenta) || idVenta <= 0) {
    return NextResponse.json({ error: "Venta inválida" }, { status: 400 });
  }

  const sucursal =
    new URL(request.url).searchParams.get("sucursal") === "usadas" ? "usadas" : "matriz";
  return sucursal === "usadas" ? detalleUsadas(idVenta) : detalleMatriz(idVenta);
}
