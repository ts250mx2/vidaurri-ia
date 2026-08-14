import { NextResponse } from "next/server";
import { consultaBdav } from "@/lib/db";
import { consultaUsadas } from "@/lib/db-usadas";
import { sesionActual } from "@/lib/auth";

// Mapa de calor de ventas. Las ventas de vidaurri solo tienen fecha (DATE, sin
// hora), así que en lugar de la clásica matriz día × hora se arman dos vistas:
//   - porMes:    filas = día de la semana (0=Lun..6=Dom), columnas = últimos N meses.
//   - porSemana: filas = día de la semana, columnas = últimas N semanas (lunes).
// Cada celda trae importe y número de ventas para que el front alterne métrica
// sin volver a consultar. ventas.fecha NO tiene índice: se hace UNA sola pasada
// GROUP BY fecha (≤ ~1 fila por día) y las dos matrices se agregan aquí en JS.

export const dynamic = "force-dynamic";

const MESES_DEFAULT = 12;
const MESES_MAX = 24;
const SEMANAS_DEFAULT = 16;
const SEMANAS_MAX = 26;
const DIAS_SEMANA = 7;

interface FilaDia {
  /** WEEKDAY de MySQL: 0=Lunes .. 6=Domingo. */
  dia: number;
  /** 'AAAA-MM' del día. */
  mes: string;
  /** 'AAAA-MM-DD' del lunes de la semana del día. */
  semana: string;
  ventas: number;
  importe: number;
}

interface Celda {
  ventas: number;
  importe: number;
}

interface MatrizCalor {
  /** Etiquetas de columna: 'AAAA-MM' (meses) o 'AAAA-MM-DD' del lunes (semanas). */
  columnas: string[];
  /** celdas[dia][columna], dia 0=Lun..6=Dom. */
  celdas: Celda[][];
  /** Totales por día (7 filas). */
  totalesFila: Celda[];
  /** Totales por columna. */
  totalesColumna: Celda[];
  /** Celda máxima por métrica: define la escala de color del front. */
  max: Celda;
}

/** Date local → 'AAAA-MM-DD'. */
function aISO(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${dia}`;
}

/** Valida un query param entero dentro de [1, max]; null si es inválido. */
function enteroEnRango(crudo: string | null, porDefecto: number, max: number): number | null {
  if (crudo === null) return porDefecto;
  const n = Number(crudo);
  if (!Number.isInteger(n) || n < 1 || n > max) return null;
  return n;
}

/** Arma una matriz día × columnas a partir de las filas diarias ya agregadas. */
function armarMatriz(
  filas: FilaDia[],
  columnas: string[],
  claveColumna: (f: FilaDia) => string
): MatrizCalor {
  const indice = new Map(columnas.map((c, i) => [c, i]));
  const celdas: Celda[][] = Array.from({ length: DIAS_SEMANA }, () =>
    columnas.map(() => ({ ventas: 0, importe: 0 }))
  );

  for (const f of filas) {
    const col = indice.get(claveColumna(f));
    // Fechas fuera del rango de esta vista (p. ej. días previos a la primera
    // semana, pero dentro del rango de meses) simplemente se ignoran.
    if (col === undefined || f.dia < 0 || f.dia >= DIAS_SEMANA) continue;
    const celda = celdas[f.dia][col];
    celda.ventas += f.ventas;
    celda.importe += f.importe;
  }

  const totalesFila = celdas.map((fila) =>
    fila.reduce(
      (acc, c) => ({ ventas: acc.ventas + c.ventas, importe: acc.importe + c.importe }),
      { ventas: 0, importe: 0 }
    )
  );
  const totalesColumna = columnas.map((_, j) =>
    celdas.reduce(
      (acc, fila) => ({
        ventas: acc.ventas + fila[j].ventas,
        importe: acc.importe + fila[j].importe,
      }),
      { ventas: 0, importe: 0 }
    )
  );
  const max = celdas.reduce(
    (acc, fila) =>
      fila.reduce(
        (m, c) => ({
          ventas: Math.max(m.ventas, c.ventas),
          importe: Math.max(m.importe, c.importe),
        }),
        acc
      ),
    { ventas: 0, importe: 0 }
  );

  return { columnas, celdas, totalesFila, totalesColumna, max };
}

export async function GET(req: Request) {
  const sesion = await sesionActual();
  if (!sesion) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const sucursal = searchParams.get("sucursal") === "usadas" ? "usadas" : "matriz";
  const meses = enteroEnRango(searchParams.get("meses"), MESES_DEFAULT, MESES_MAX);
  const semanas = enteroEnRango(searchParams.get("semanas"), SEMANAS_DEFAULT, SEMANAS_MAX);
  if (meses === null || semanas === null) {
    return NextResponse.json(
      { error: "Parámetros de rango inválidos (meses 1-24, semanas 1-26)" },
      { status: 400 }
    );
  }

  // Rango mensual: desde el día 1 del mes que queda (meses - 1) meses atrás.
  const hoy = new Date();
  const inicioMeses = new Date(hoy.getFullYear(), hoy.getMonth() - (meses - 1), 1);
  const listaMeses = Array.from({ length: meses }, (_, i) => {
    const d = new Date(inicioMeses.getFullYear(), inicioMeses.getMonth() + i, 1);
    return aISO(d).slice(0, 7);
  });

  // Rango semanal: lunes de la semana actual hacia atrás (semanas - 1) semanas.
  const lunesActual = new Date(
    hoy.getFullYear(),
    hoy.getMonth(),
    hoy.getDate() - ((hoy.getDay() + 6) % 7)
  );
  const listaSemanas = Array.from({ length: semanas }, (_, i) => {
    const d = new Date(lunesActual);
    d.setDate(lunesActual.getDate() - 7 * (semanas - 1 - i));
    return aISO(d);
  });

  // Una sola consulta cubre ambas vistas: se pide desde la fecha más antigua.
  const desde = listaSemanas[0] < aISO(inicioMeses) ? listaSemanas[0] : aISO(inicioMeses);

  // UNA pasada sobre ventas (fecha sin índice: nunca una consulta por día).
  // WEEKDAY: 0=Lunes..6=Domingo; la columna semana es el lunes de esa semana.
  const sql = `
    SELECT WEEKDAY(fecha)                                                        AS dia,
           DATE_FORMAT(fecha, '%Y-%m')                                           AS mes,
           DATE_FORMAT(DATE_SUB(fecha, INTERVAL WEEKDAY(fecha) DAY), '%Y-%m-%d') AS semana,
           COUNT(*)                                                              AS ventas,
           IFNULL(SUM(total), 0)                                                 AS importe
      FROM ventas
     WHERE fecha >= ?
     GROUP BY fecha
     ORDER BY fecha
  `;

  try {
    const filas =
      sucursal === "usadas"
        ? await consultaUsadas<FilaDia>(sql, [desde])
        : await consultaBdav<FilaDia>(sql, [desde]);

    const porMes = armarMatriz(filas, listaMeses, (f) => f.mes);
    const porSemana = armarMatriz(filas, listaSemanas, (f) => f.semana);
    const total = porMes.totalesColumna.reduce(
      (acc, c) => ({ ventas: acc.ventas + c.ventas, importe: acc.importe + c.importe }),
      { ventas: 0, importe: 0 }
    );

    return NextResponse.json({ sucursal, desde, porMes, porSemana, total });
  } catch (error) {
    console.error("Error en mapa de calor de ventas:", error);
    return NextResponse.json(
      {
        error:
          sucursal === "usadas"
            ? "No fue posible consultar la base de la Bodega Usado"
            : "No fue posible consultar la base de datos",
      },
      { status: 502 }
    );
  }
}
