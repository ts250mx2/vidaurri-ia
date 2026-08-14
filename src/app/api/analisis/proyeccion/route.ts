import { NextResponse } from "next/server";
import { consultaBdav } from "@/lib/db";
import { consultaUsadas } from "@/lib/db-usadas";
import { sesionActual } from "@/lib/auth";
import { hoyISO } from "@/lib/formato";
import {
  proyectarSerieMensual,
  rellenarMesesFaltantes,
  type PuntoMes,
} from "@/lib/proyeccion";

export const dynamic = "force-dynamic";

// Proyección de ventas: serie mensual histórica + proyección estadística.
// GET /api/analisis/proyeccion?sucursal=matriz|usadas&meses=1..12
//
// - matriz: bdav (historia desde 2016). ventas.fecha NO tiene índice: la serie
//   se agrega en UNA sola consulta GROUP BY por mes (una pasada a la tabla),
//   nunca en bucles de consultas por día o por mes.
// - usadas: base remota de la Bodega Usado (historia desde dic-2024). Con poca
//   historia la librería degrada el método y lo declara en `metodo`/`nota`.
//
// El mes en curso está incompleto: se devuelve aparte (mesEnCurso) y NO entra
// al modelo, porque metería una caída falsa al final de la serie.

interface FilaMes {
  mes: string;
  ventas: number;
  total: number;
}

// Meses de historia que se devuelven al cliente (la página muestra 12-18).
const MESES_HISTORIA_RESPUESTA = 24;

const SQL_SERIE_MENSUAL = `
  SELECT DATE_FORMAT(fecha, '%Y-%m') AS mes,
         COUNT(*)                    AS ventas,
         IFNULL(SUM(total), 0)       AS total
    FROM ventas
   WHERE fecha >= '2010-01-01' -- descarta fechas corruptas del POS legacy
   GROUP BY 1
   ORDER BY 1
`;

export async function GET(request: Request) {
  const sesion = await sesionActual();
  if (!sesion) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const sucursal = searchParams.get("sucursal") === "usadas" ? "usadas" : "matriz";

  // Meses a proyectar: entero de 1 a 12, default 6.
  let meses = 6;
  const mesesParam = searchParams.get("meses");
  if (mesesParam !== null) {
    const n = Number(mesesParam);
    if (!Number.isInteger(n) || n < 1 || n > 12) {
      return NextResponse.json(
        { error: "Parámetro 'meses' inválido: se espera un entero entre 1 y 12." },
        { status: 400 }
      );
    }
    meses = n;
  }

  try {
    const filas =
      sucursal === "usadas"
        ? await consultaUsadas<FilaMes>(SQL_SERIE_MENSUAL)
        : await consultaBdav<FilaMes>(SQL_SERIE_MENSUAL);

    // Separa el mes en curso (incompleto) de los meses completos.
    const mesActual = hoyISO().slice(0, 7);
    const mesEnCurso = filas.find((f) => f.mes === mesActual) ?? null;
    const completas = filas.filter((f) => f.mes < mesActual);

    // Serie continua (meses sin ventas cuentan como 0) para el modelo y la gráfica.
    const serie: PuntoMes[] = rellenarMesesFaltantes(
      completas.map((f) => ({ mes: f.mes, total: Number(f.total) || 0 }))
    );
    const ventasPorMes = new Map(completas.map((f) => [f.mes, Number(f.ventas) || 0]));

    const resultado = proyectarSerieMensual(serie, meses);

    const historia = serie.slice(-MESES_HISTORIA_RESPUESTA).map((p) => ({
      mes: p.mes,
      ventas: ventasPorMes.get(p.mes) ?? 0,
      total: p.total,
    }));

    return NextResponse.json({
      sucursal,
      mesesProyectados: meses,
      historia,
      mesEnCurso,
      proyeccion: resultado.proyeccion,
      metodo: resultado.metodo,
      confianza: resultado.confianza,
      r2: resultado.r2,
      tendenciaMensualPct: resultado.tendenciaMensualPct,
      mesesUsados: resultado.mesesUsados,
      nota: resultado.nota,
    });
  } catch (error) {
    console.error(`Error en proyección de ventas (${sucursal}):`, error);
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
