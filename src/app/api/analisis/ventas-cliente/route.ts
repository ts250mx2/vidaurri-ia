import { NextResponse } from "next/server";
import { consultaBdav } from "@/lib/db";
import { consultaUsadas } from "@/lib/db-usadas";
import { sesionActual } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Análisis de ventas por cliente (ranking tipo Pareto). Agrega TODO el rango
// en una sola pasada por base (GROUP BY); el ranking, la participación % y el
// acumulado se calculan en memoria porque necesitan el total del rango completo
// (unos pocos miles de clientes como máximo, no es problema).

const ES_FECHA = /^\d{4}-\d{2}-\d{2}$/;
// "limite" solo se usa para recortar el arreglo en JS (nunca se interpola en SQL).
const LIMITE_DEFAULT = 100;
const LIMITE_MAX = 500;
// Cuántos clientes del tope se usan para el KPI de concentración.
const TOP_CONCENTRACION = 10;

interface FilaAgregado {
  cliente: string;
  compras: number;
  importe: number;
  ultimaCompra: string;
}

interface FilaPiezas {
  cliente: string;
  piezas: number;
}

interface ClienteRanking {
  posicion: number;
  cliente: string;
  compras: number;
  piezas: number;
  importe: number;
  ticketPromedio: number;
  /** % del importe del cliente sobre el total del rango. */
  participacion: number;
  /** % acumulado del ranking (curva de Pareto). */
  acumulado: number;
  ultimaCompra: string;
}

interface Filtros {
  fechaInicio: string;
  fechaFin: string;
  busqueda: string;
  limite: number;
}

/** Ordena, calcula participación/acumulado/KPIs y aplica la búsqueda al final
 *  para que la posición y el Pareto siempre reflejen el ranking global del rango. */
function armarRespuesta(f: Filtros, agregados: FilaAgregado[], filasPiezas: FilaPiezas[]) {
  const piezasPorCliente = new Map<string, number>(
    filasPiezas.map((p) => [p.cliente, Number(p.piezas) || 0])
  );

  const ordenados = [...agregados].sort(
    (a, b) => (Number(b.importe) || 0) - (Number(a.importe) || 0)
  );
  const importeTotal = ordenados.reduce((s, c) => s + (Number(c.importe) || 0), 0);
  const comprasTotales = ordenados.reduce((s, c) => s + (Number(c.compras) || 0), 0);

  let acumulado = 0;
  const ranking: ClienteRanking[] = ordenados.map((c, i) => {
    const importe = Number(c.importe) || 0;
    const compras = Number(c.compras) || 0;
    const participacion = importeTotal > 0 ? (importe / importeTotal) * 100 : 0;
    acumulado += participacion;
    return {
      posicion: i + 1,
      cliente: c.cliente,
      compras,
      piezas: piezasPorCliente.get(c.cliente) ?? 0,
      importe,
      ticketPromedio: compras > 0 ? importe / compras : 0,
      participacion,
      acumulado,
      ultimaCompra: c.ultimaCompra,
    };
  });

  const piezasTotales = ranking.reduce((s, c) => s + c.piezas, 0);
  const top10Pct = ranking
    .slice(0, TOP_CONCENTRACION)
    .reduce((s, c) => s + c.participacion, 0);

  const filtro = f.busqueda.toLowerCase();
  const filtrados = filtro
    ? ranking.filter((c) => c.cliente.toLowerCase().includes(filtro))
    : ranking;

  return NextResponse.json({
    fechaInicio: f.fechaInicio,
    fechaFin: f.fechaFin,
    busqueda: f.busqueda,
    kpis: {
      clientes: ranking.length,
      compras: comprasTotales,
      piezas: piezasTotales,
      importe: importeTotal,
      ticketPromedio: comprasTotales > 0 ? importeTotal / comprasTotales : 0,
      top10Pct,
    },
    totalClientes: filtrados.length,
    clientes: filtrados.slice(0, f.limite),
  });
}

async function analizarMatriz(f: Filtros) {
  // Igual que /api/ventas: el cliente efectivo es el nombre capturado en la
  // venta (mostrador / público general) o, si viene vacío, el del catálogo.
  // Así las ventas de mostrador con nombre capturado se agrupan por ese nombre
  // y el resto bajo su cliente registrado. ventas.fecha no tiene índice: todo
  // se agrega en UNA consulta GROUP BY por base, nunca en bucles por día.
  try {
    const [agregados, filasPiezas] = await Promise.all([
      consultaBdav<FilaAgregado>(
        `SELECT IFNULL(NULLIF(v.nombre, ''), c.nombre) AS cliente,
                COUNT(*)                               AS compras,
                IFNULL(SUM(v.total), 0)                AS importe,
                MAX(v.fecha)                           AS ultimaCompra
           FROM ventas v
           JOIN clientes c ON c.id = v.id_cliente
          WHERE v.fecha BETWEEN ? AND ?
          GROUP BY cliente`,
        [f.fechaInicio, f.fechaFin]
      ),
      // Piezas por cliente en una segunda agregación (unir el detalle dentro
      // del GROUP BY anterior inflaría el conteo de compras). La latencia
      // (~7 s en bdav) la domina la falta de índice en ventas.fecha, no el
      // código: corre en Promise.all y ya es una sola pasada. El índice
      // recomendado está en docs/indices-recomendados.sql y beneficia a todos
      // los reportes de análisis.
      consultaBdav<FilaPiezas>(
        `SELECT IFNULL(NULLIF(v.nombre, ''), c.nombre) AS cliente,
                IFNULL(SUM(dv.cantidad), 0)            AS piezas
           FROM ventas v
           JOIN clientes c ON c.id = v.id_cliente
           JOIN detalle_venta dv ON dv.id_venta = v.id
          WHERE v.fecha BETWEEN ? AND ?
          GROUP BY cliente`,
        [f.fechaInicio, f.fechaFin]
      ),
    ]);
    return armarRespuesta(f, agregados, filasPiezas);
  } catch (error) {
    console.error("Error en análisis de ventas por cliente:", error);
    return NextResponse.json(
      { error: "No fue posible consultar las ventas por cliente" },
      { status: 502 }
    );
  }
}

async function analizarUsadas(f: Filtros) {
  // La Bodega Usado no tiene catálogo de clientes: se agrupa por el nombre
  // capturado en la venta (NULL o vacío = público general).
  try {
    const [agregados, filasPiezas] = await Promise.all([
      consultaUsadas<FilaAgregado>(
        `SELECT IFNULL(NULLIF(v.nombre_cliente, ''), 'Público general') AS cliente,
                COUNT(*)                                                AS compras,
                IFNULL(SUM(v.total), 0)                                 AS importe,
                MAX(v.fecha)                                            AS ultimaCompra
           FROM ventas v
          WHERE v.fecha BETWEEN ? AND ?
          GROUP BY cliente`,
        [f.fechaInicio, f.fechaFin]
      ),
      consultaUsadas<FilaPiezas>(
        `SELECT IFNULL(NULLIF(v.nombre_cliente, ''), 'Público general') AS cliente,
                IFNULL(SUM(vd.cantidad), 0)                             AS piezas
           FROM ventas v
           JOIN venta_detalle vd ON vd.id_venta = v.id_venta
          WHERE v.fecha BETWEEN ? AND ?
          GROUP BY cliente`,
        [f.fechaInicio, f.fechaFin]
      ),
    ]);
    return armarRespuesta(f, agregados, filasPiezas);
  } catch (error) {
    console.error("Error en análisis de ventas por cliente (Bodega Usado):", error);
    return NextResponse.json(
      { error: "No fue posible consultar la base de la Bodega Usado" },
      { status: 502 }
    );
  }
}

/** Fecha local 'AAAA-MM-DD'. */
function fechaISO(d: Date): string {
  return d.toLocaleDateString("sv-SE");
}

/** Rango por defecto: últimos 12 meses hasta hoy. */
function hace12Meses(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return fechaISO(d);
}

export async function GET(request: Request) {
  const sesion = await sesionActual();
  if (!sesion) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const sucursal = searchParams.get("sucursal") === "usadas" ? "usadas" : "matriz";
  const limite = Number(searchParams.get("limite"));
  const filtros: Filtros = {
    fechaInicio: ES_FECHA.test(searchParams.get("fechaInicio") ?? "")
      ? searchParams.get("fechaInicio")!
      : hace12Meses(),
    fechaFin: ES_FECHA.test(searchParams.get("fechaFin") ?? "")
      ? searchParams.get("fechaFin")!
      : fechaISO(new Date()),
    busqueda: (searchParams.get("busqueda") ?? "").trim(),
    limite:
      Number.isInteger(limite) && limite >= 1 ? Math.min(limite, LIMITE_MAX) : LIMITE_DEFAULT,
  };

  return sucursal === "usadas" ? analizarUsadas(filtros) : analizarMatriz(filtros);
}
