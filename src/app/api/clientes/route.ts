import { NextResponse } from "next/server";
import { consultaBdav } from "@/lib/db";
import { sesionActual } from "@/lib/auth";

export const dynamic = "force-dynamic";

const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 20000; // permite exportar el padrón completo

interface FilaCliente {
  id: number;
  nombre: string;
  rfc: string | null;
  telefono: string | null;
  ciudad: string | null;
  estado: string | null;
  descuento: number;
  limiteCredito: number;
  saldo: number;
  activo: number;
  bloqueado: number;
}

interface FilaResumen {
  clientes: number;
  conSaldo: number;
  cartera: number;
  descuentoPromedio: number;
}

export async function GET(request: Request) {
  const sesion = await sesionActual();
  if (!sesion) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const busqueda = (searchParams.get("busqueda") ?? "").trim();
  const conSaldo = searchParams.get("conSaldo") === "1";
  const incluirInactivos = searchParams.get("incluirInactivos") === "1";
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const pageSize = Math.min(
    PAGE_SIZE_MAX,
    Math.max(1, Number(searchParams.get("pageSize")) || PAGE_SIZE_DEFAULT)
  );

  // Filtros dinámicos, siempre parametrizados.
  // Los bit(1) llegan como Buffer con mysql2: (campo + 0) los convierte a 0/1.
  const condiciones: string[] = [];
  const params: unknown[] = [];
  if (!incluirInactivos) {
    condiciones.push("(c.activo + 0) = 1");
  }
  if (conSaldo) {
    condiciones.push("c.saldo > 0");
  }
  if (busqueda) {
    // RFC con prefijo (aprovecha índice); nombre y teléfono con LIKE amplio.
    condiciones.push("(c.nombre LIKE ? OR c.rfc LIKE ? OR c.telefono LIKE ?)");
    params.push(`%${busqueda}%`, `${busqueda}%`, `%${busqueda}%`);
  }
  const where = condiciones.length > 0 ? `WHERE ${condiciones.join(" AND ")}` : "";
  const offset = (page - 1) * pageSize;

  try {
    const [filas, conteo, resumen] = await Promise.all([
      consultaBdav<FilaCliente>(
        `SELECT c.id, c.nombre, c.rfc, c.telefono, c.ciudad, c.estado,
                IFNULL(c.descuento, 0) AS descuento,
                IFNULL(c.limite_credito, 0) AS limiteCredito,
                IFNULL(c.saldo, 0) AS saldo,
                (c.activo + 0) AS activo,
                (c.bloqueo_por_adeudo + 0) AS bloqueado
           FROM clientes c
          ${where}
          ORDER BY c.saldo DESC, c.nombre ASC
          LIMIT ${offset}, ${pageSize}`,
        params
      ),
      consultaBdav<{ total: number }>(
        `SELECT COUNT(*) AS total
           FROM clientes c
          ${where}`,
        params
      ),
      consultaBdav<FilaResumen>(
        `SELECT COUNT(*)                          AS clientes,
                IFNULL(SUM(c.saldo > 0), 0)       AS conSaldo,
                IFNULL(SUM(c.saldo), 0)           AS cartera,
                IFNULL(AVG(c.descuento), 0)       AS descuentoPromedio
           FROM clientes c
          ${where}`,
        params
      ),
    ]);

    return NextResponse.json({
      page,
      pageSize,
      total: conteo[0]?.total ?? 0,
      resumen: resumen[0] ?? null,
      clientes: filas,
    });
  } catch (error) {
    console.error("Error listando clientes:", error);
    return NextResponse.json(
      { error: "No fue posible consultar los clientes" },
      { status: 502 }
    );
  }
}
