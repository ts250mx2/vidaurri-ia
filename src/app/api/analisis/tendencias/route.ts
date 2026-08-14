import { NextResponse } from "next/server";
import { consultaBdav } from "@/lib/db";
import { consultaUsadas } from "@/lib/db-usadas";
import { sesionActual } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Tendencias de venta: serie agregada por periodo (día/semana/mes), comparativo
// contra el periodo anterior equivalente (misma duración, inmediatamente
// previo) y KPIs del rango. El mismo SQL sirve para la Matriz (bdav.ventas) y
// para la Bodega Usado: ambas tablas de ventas exponen fecha (DATE) y total.

const ES_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const MS_POR_DIA = 86400000;
// Tope de periodos al rellenar la serie con ceros (~3 años por día); el rango
// ya llega acotado, la guarda solo evita secuencias desmedidas.
const MAX_PERIODOS_RELLENO = 1100;

type Granularidad = "dia" | "semana" | "mes";

// Expresiones de agrupación por granularidad. Las claves son fijas y la
// granularidad se valida contra ellas: al SQL solo se interpola texto de esta
// tabla, nunca del usuario; las fechas van siempre con placeholders (?).
// ventas.fecha no tiene índice ni hora, por eso toda la serie se agrega en UNA
// consulta GROUP BY (más una segunda para los totales del periodo anterior).
const EXPRESION_PERIODO: Record<Granularidad, string> = {
  dia: "DATE_FORMAT(v.fecha, '%Y-%m-%d')",
  // Cada semana se identifica por la fecha de su lunes (inicio ISO).
  semana: "DATE_FORMAT(DATE_SUB(v.fecha, INTERVAL WEEKDAY(v.fecha) DAY), '%Y-%m-%d')",
  mes: "DATE_FORMAT(v.fecha, '%Y-%m')",
};

interface FilaSerie {
  periodo: string;
  ventas: number;
  importe: number;
}

interface FilaTotales {
  ventas: number;
  importe: number;
}

// Fila de la serie que se responde al cliente: "parcial" marca los periodos
// que el rango consultado no cubre completos.
interface FilaSerieSalida extends FilaSerie {
  parcial: boolean;
}

function hoyISO(): string {
  return new Date().toLocaleDateString("sv-SE");
}

/** Primer día del mes de hace 11 meses: rango por defecto (últimos 12 meses). */
function inicioPorDefecto(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 11);
  return d.toLocaleDateString("sv-SE");
}

/** Suma días a una fecha 'AAAA-MM-DD' operando en UTC (independiente de zona horaria). */
function sumarDias(fecha: string, dias: number): string {
  const [a, m, d] = fecha.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

/** Días del rango, ambos extremos incluidos. */
function diasEntre(inicio: string, fin: string): number {
  const [a1, m1, d1] = inicio.split("-").map(Number);
  const [a2, m2, d2] = fin.split("-").map(Number);
  return Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / MS_POR_DIA) + 1;
}

/** Lunes (inicio ISO) de la semana de una fecha 'AAAA-MM-DD' — mismo criterio que el SQL. */
function lunesDe(fecha: string): string {
  const [a, m, d] = fecha.split("-").map(Number);
  // WEEKDAY de MySQL: lunes=0 ... domingo=6; getUTCDay: domingo=0.
  const desplaza = (new Date(Date.UTC(a, m - 1, d)).getUTCDay() + 6) % 7;
  return sumarDias(fecha, -desplaza);
}

/** Último día del mes de una fecha 'AAAA-MM-DD'. */
function finDeMes(fecha: string): string {
  const [a, m] = fecha.split("-").map(Number);
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
}

/** Clave de serie a la que pertenece una fecha según la granularidad. */
function periodoDe(fecha: string, gran: Granularidad): string {
  if (gran === "mes") return fecha.slice(0, 7);
  if (gran === "semana") return lunesDe(fecha);
  return fecha;
}

/** Secuencia completa de periodos entre dos fechas según la granularidad. */
function periodosDelRango(inicio: string, fin: string, gran: Granularidad): string[] {
  const periodos: string[] = [];
  let periodo = periodoDe(inicio, gran);
  const ultimo = periodoDe(fin, gran);
  // La guarda corta secuencias desmedidas; el excedente lo detecta quien llama.
  while (periodo <= ultimo && periodos.length <= MAX_PERIODOS_RELLENO) {
    periodos.push(periodo);
    if (gran === "mes") {
      const [a, m] = periodo.split("-").map(Number);
      periodo = m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, "0")}`;
    } else {
      periodo = sumarDias(periodo, gran === "semana" ? 7 : 1);
    }
  }
  return periodos;
}

/** % de variación contra el valor anterior; null si no hay base de comparación. */
function variacion(actual: number, anterior: number): number | null {
  if (anterior <= 0) return null;
  return ((actual - anterior) / anterior) * 100;
}

export async function GET(request: Request) {
  const sesion = await sesionActual();
  if (!sesion) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const sucursal = searchParams.get("sucursal") === "usadas" ? "usadas" : "matriz";
  const granParam = searchParams.get("granularidad");
  const granularidad: Granularidad =
    granParam === "dia" || granParam === "semana" ? granParam : "mes";

  const inicioParam = searchParams.get("fechaInicio") ?? "";
  const finParam = searchParams.get("fechaFin") ?? "";
  let fechaInicio = ES_FECHA.test(inicioParam) ? inicioParam : inicioPorDefecto();
  let fechaFin = ES_FECHA.test(finParam) ? finParam : hoyISO();
  // Rango invertido: se corrige en lugar de fallar (formato 'AAAA-MM-DD' ordena lexicográficamente).
  if (fechaInicio > fechaFin) [fechaInicio, fechaFin] = [fechaFin, fechaInicio];

  // Periodo anterior equivalente: misma cantidad de días, terminando el día
  // previo al inicio del rango consultado.
  const dias = diasEntre(fechaInicio, fechaFin);
  const anteriorFin = sumarDias(fechaInicio, -1);
  const anteriorInicio = sumarDias(fechaInicio, -dias);

  const sqlSerie = `SELECT ${EXPRESION_PERIODO[granularidad]} AS periodo,
                           COUNT(*) AS ventas,
                           IFNULL(SUM(v.total), 0) AS importe
                      FROM ventas v
                     WHERE v.fecha BETWEEN ? AND ?
                     GROUP BY periodo
                     ORDER BY periodo`;
  const sqlTotales = `SELECT COUNT(*) AS ventas, IFNULL(SUM(v.total), 0) AS importe
                        FROM ventas v
                       WHERE v.fecha BETWEEN ? AND ?`;

  // Ambas bases comparten firma de consulta; se anota el tipo para conservar el genérico.
  const ejecutar: <T>(sql: string, params?: unknown[]) => Promise<T[]> =
    sucursal === "usadas" ? consultaUsadas : consultaBdav;

  try {
    const [serie, filasAnterior] = await Promise.all([
      ejecutar<FilaSerie>(sqlSerie, [fechaInicio, fechaFin]),
      ejecutar<FilaTotales>(sqlTotales, [anteriorInicio, anteriorFin]),
    ]);

    // El GROUP BY solo devuelve periodos con venta: se genera la secuencia
    // completa del rango y se rellenan los faltantes con ceros. Si la
    // secuencia rebasa la guarda, la serie se deja tal cual llegó de la base.
    const secuencia = periodosDelRango(fechaInicio, fechaFin, granularidad);
    const porPeriodo = new Map(serie.map((p) => [p.periodo, p]));
    const filas =
      secuencia.length > MAX_PERIODOS_RELLENO
        ? serie
        : secuencia.map((periodo) => porPeriodo.get(periodo) ?? { periodo, ventas: 0, importe: 0 });

    // Periodos parciales: el primero si fechaInicio no cae en su frontera
    // natural (día 1 del mes / lunes) y el último si fechaFin no cae en su
    // cierre (fin de mes / domingo). Con granularidad "dia" nunca hay parciales.
    const inicioParcial =
      granularidad === "mes"
        ? !fechaInicio.endsWith("-01")
        : granularidad === "semana" && lunesDe(fechaInicio) !== fechaInicio;
    const finParcial =
      granularidad === "mes"
        ? fechaFin !== finDeMes(fechaFin)
        : granularidad === "semana" && sumarDias(lunesDe(fechaFin), 6) !== fechaFin;
    const primerPeriodo = periodoDe(fechaInicio, granularidad);
    const ultimoPeriodo = periodoDe(fechaFin, granularidad);
    const serieCompleta: FilaSerieSalida[] = filas.map((p) => ({
      ...p,
      parcial:
        (p.periodo === primerPeriodo && inicioParcial) ||
        (p.periodo === ultimoPeriodo && finParcial),
    }));

    // KPIs derivados de la serie ya rellenada (los periodos sin venta suman cero).
    const ventasTotales = serieCompleta.reduce((acc, p) => acc + (Number(p.ventas) || 0), 0);
    const importeTotal = serieCompleta.reduce((acc, p) => acc + (Number(p.importe) || 0), 0);
    const ticketPromedio = ventasTotales > 0 ? importeTotal / ventasTotales : 0;
    const promedioPorPeriodo = serieCompleta.length > 0 ? importeTotal / serieCompleta.length : 0;

    // Los parciales no compiten por mejor/peor (no cubren el periodo
    // completo); si todos son parciales se consideran todos, como antes.
    const completos = serieCompleta.filter((p) => !p.parcial);
    const candidatos = completos.length > 0 ? completos : serieCompleta;
    let mejorPeriodo: FilaSerieSalida | null = null;
    let peorPeriodo: FilaSerieSalida | null = null;
    for (const p of candidatos) {
      if (!mejorPeriodo || Number(p.importe) > Number(mejorPeriodo.importe)) mejorPeriodo = p;
      if (!peorPeriodo || Number(p.importe) < Number(peorPeriodo.importe)) peorPeriodo = p;
    }

    const anterior = filasAnterior[0] ?? { ventas: 0, importe: 0 };
    const ventasAnterior = Number(anterior.ventas) || 0;
    const importeAnterior = Number(anterior.importe) || 0;

    return NextResponse.json({
      sucursal,
      fechaInicio,
      fechaFin,
      granularidad,
      serie: serieCompleta,
      comparativo: {
        periodoAnterior: { fechaInicio: anteriorInicio, fechaFin: anteriorFin },
        actual: { ventas: ventasTotales, importe: importeTotal },
        anterior: { ventas: ventasAnterior, importe: importeAnterior },
        variacionImporte: variacion(importeTotal, importeAnterior),
        variacionVentas: variacion(ventasTotales, ventasAnterior),
      },
      kpis: {
        importeTotal,
        ventasTotales,
        ticketPromedio,
        promedioPorPeriodo,
        mejorPeriodo: mejorPeriodo
          ? { periodo: mejorPeriodo.periodo, importe: Number(mejorPeriodo.importe) || 0 }
          : null,
        peorPeriodo: peorPeriodo
          ? { periodo: peorPeriodo.periodo, importe: Number(peorPeriodo.importe) || 0 }
          : null,
      },
    });
  } catch (error) {
    console.error("Error consultando tendencias de venta:", error);
    const mensaje =
      sucursal === "usadas"
        ? "No fue posible consultar la base de la Bodega Usado"
        : "No fue posible consultar las tendencias de venta";
    return NextResponse.json({ error: mensaje }, { status: 502 });
  }
}
