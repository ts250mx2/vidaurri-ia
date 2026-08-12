import { NextResponse } from "next/server";
import { consultaBdav } from "@/lib/db";
import { sesionActual } from "@/lib/auth";

export const dynamic = "force-dynamic";

const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 20000; // permite exportar el listado completo
const ESTATUS_VALIDOS = ["ABIERTA", "PROCESO", "RECIBIDA", "VENTA"];

interface FilaBackOrder {
  id: number;
  numBko: number;
  fechaBko: string;
  cliente: string;
  telefono: string | null;
  vendedor: string;
  proveedor: string;
  subtotal: number;
  iva: number;
  total: number;
  anticipo: number;
  liquida: number;
  saldo: number;
  estatus: string | null;
  fechaCompromiso: string | null;
  comentarios: string | null;
}

interface FilaResumen {
  backOrders: number;
  abiertas: number;
  importe: number;
  anticipos: number;
  saldoPorCobrar: number;
}

export async function GET(request: Request) {
  const sesion = await sesionActual();
  if (!sesion) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const estatus = searchParams.get("estatus") ?? "";
  const busqueda = (searchParams.get("busqueda") ?? "").trim();
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const pageSize = Math.min(
    PAGE_SIZE_MAX,
    Math.max(1, Number(searchParams.get("pageSize")) || PAGE_SIZE_DEFAULT)
  );

  // Sin filtro de fechas: solo hay ~70 back orders; se pagina por consistencia.
  const condiciones: string[] = [];
  const params: unknown[] = [];
  if (ESTATUS_VALIDOS.includes(estatus)) {
    condiciones.push("b.estatus = ?");
    params.push(estatus);
  }
  if (busqueda) {
    // Folio exacto o nombre de cliente (capturado en el BKO o del catálogo).
    condiciones.push("(b.num_bko = ? OR b.nombre_cliente LIKE ? OR c.nombre LIKE ?)");
    params.push(Number(busqueda) || 0, `%${busqueda}%`, `%${busqueda}%`);
  }
  const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";
  const offset = (page - 1) * pageSize;

  try {
    const [filas, conteo, resumen] = await Promise.all([
      consultaBdav<FilaBackOrder>(
        `SELECT b.id, b.num_bko AS numBko, b.fecha_bko AS fechaBko,
                IFNULL(NULLIF(b.nombre_cliente, ''), c.nombre) AS cliente,
                IFNULL(NULLIF(b.telefono, ''), c.telefono) AS telefono,
                ve.vendedor, p.nombre AS proveedor,
                IFNULL(b.subtotal, 0) AS subtotal, IFNULL(b.iva, 0) AS iva,
                IFNULL(b.total, 0) AS total, IFNULL(b.anticipo, 0) AS anticipo,
                IFNULL(b.liquida, 0) AS liquida, IFNULL(b.saldo, 0) AS saldo,
                b.estatus, b.fecha_compromiso AS fechaCompromiso, b.comentarios
           FROM back_order b
           JOIN clientes c     ON c.id = b.id_cte
           JOIN vendedores ve  ON ve.id = b.id_vendedor
           JOIN proveedores p  ON p.id = b.id_prov
          ${where}
          ORDER BY b.fecha_bko DESC, b.id DESC
          LIMIT ${offset}, ${pageSize}`,
        params
      ),
      consultaBdav<{ total: number }>(
        `SELECT COUNT(*) AS total
           FROM back_order b
           JOIN clientes c     ON c.id = b.id_cte
           JOIN vendedores ve  ON ve.id = b.id_vendedor
           JOIN proveedores p  ON p.id = b.id_prov
          ${where}`,
        params
      ),
      consultaBdav<FilaResumen>(
        `SELECT COUNT(*)                                     AS backOrders,
                SUM(b.estatus IN ('ABIERTA', 'PROCESO'))     AS abiertas,
                IFNULL(SUM(b.total), 0)                      AS importe,
                IFNULL(SUM(b.anticipo), 0)                   AS anticipos,
                IFNULL(SUM(b.saldo), 0)                      AS saldoPorCobrar
           FROM back_order b
           JOIN clientes c     ON c.id = b.id_cte
           JOIN vendedores ve  ON ve.id = b.id_vendedor
           JOIN proveedores p  ON p.id = b.id_prov
          ${where}`,
        params
      ),
    ]);

    return NextResponse.json({
      page,
      pageSize,
      total: conteo[0]?.total ?? 0,
      resumen: resumen[0] ?? null,
      backOrders: filas,
    });
  } catch (error) {
    console.error("Error listando back orders:", error);
    return NextResponse.json(
      { error: "No fue posible consultar los back orders" },
      { status: 502 }
    );
  }
}
