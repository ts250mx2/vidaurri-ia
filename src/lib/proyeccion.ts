// Proyección de ventas mensuales — funciones puras, sin dependencias.
//
// Matemática portada del forecasting del dashboard de referencia (regresión
// lineal + estacionalidad + banda de confianza), cambiando la unidad de
// tiempo: allá la serie es diaria con estacionalidad semanal (día de la
// semana); aquí la serie es MENSUAL con estacionalidad anual (mes calendario).
//
// Algoritmo principal (metodo "regresion-estacional"):
//   1. Tendencia: regresión lineal y = m·x + b (mínimos cuadrados) sobre el
//      índice de mes de los últimos 24 meses.
//   2. Residuos: r_i = y_i − tendencia(i).
//   3. Factor estacional aditivo: promedio de residuos por mes calendario
//      (ene..dic); requiere ≥ 24 meses para tener ≥ 2 muestras por mes.
//   4. Proyección: tendencia(x) + factor(mes calendario de x).
//   5. Rango: ± 1.96·σ(residuos) ≈ intervalo de ~95 % si los residuos son
//      aproximadamente normales (pesimista/optimista).
//
// Con historia corta el método se degrada de forma declarada en `nota`:
//   - 8 a 23 meses -> regresión lineal sin estacionalidad.
//   - < 8 meses    -> promedio móvil ponderado (peso 1/(1+k), k = antigüedad).

export interface PuntoMes {
  /** Mes en formato 'AAAA-MM'. */
  mes: string;
  total: number;
}

export interface PuntoProyeccion {
  mes: string;
  estimado: number;
  pesimista: number;
  optimista: number;
}

export type MetodoProyeccion =
  | "regresion-estacional"
  | "regresion-lineal"
  | "promedio-movil";

export type NivelConfianza = "alta" | "media" | "baja";

export interface ResultadoProyeccion {
  proyeccion: PuntoProyeccion[];
  metodo: MetodoProyeccion;
  confianza: NivelConfianza;
  /** R² del ajuste (solo métodos de regresión): 0 = mal ajuste, 1 = perfecto. */
  r2: number | null;
  /** Pendiente de la tendencia como % del nivel promedio mensual. */
  tendenciaMensualPct: number;
  /** Meses de historia realmente usados por el modelo. */
  mesesUsados: number;
  /** Descripción corta del método, lista para mostrar al usuario. */
  nota: string;
}

// Ventanas y umbrales del modelo.
const VENTANA_REGRESION = 24; // meses máximos para ajustar la tendencia
const MINIMO_REGRESION = 8; // por debajo de esto se usa promedio móvil
const MINIMO_ESTACIONAL = 24; // 2 muestras por mes calendario
const VENTANA_PROMEDIO = 6; // meses del promedio móvil ponderado
const Z_95 = 1.96; // cuantil normal para banda de ~95 %
// Tope de relleno de meses (guarda contra series con fechas corruptas).
const MAX_MESES_RELLENO = 600;

/** Índice absoluto de un 'AAAA-MM' (año·12 + mes) para aritmética de meses. */
function indiceMes(mes: string): number {
  const [a, m] = mes.split("-").map(Number);
  return a * 12 + (m - 1);
}

/** 'AAAA-MM' a partir de un índice absoluto de mes. */
function mesDesdeIndice(indice: number): string {
  const a = Math.floor(indice / 12);
  const m = (indice % 12) + 1;
  return `${String(a).padStart(4, "0")}-${String(m).padStart(2, "0")}`;
}

/** Mes siguiente a un 'AAAA-MM'. */
export function mesSiguiente(mes: string): string {
  // Aritmética de índices, no el constructor Date: con años < 100 (fechas
  // corruptas tipo '0099-12') Date los remapea a 19xx y rompe la serie.
  return mesDesdeIndice(indiceMes(mes) + 1);
}

/**
 * Rellena con total 0 los meses ausentes entre el primero y el último de la
 * serie: el modelo asume puntos mensuales consecutivos, y un mes sin ventas
 * (posible en la Bodega Usado) debe contar como 0, no desaparecer.
 */
export function rellenarMesesFaltantes(serie: PuntoMes[]): PuntoMes[] {
  if (serie.length === 0) return [];
  const ordenada = [...serie].sort((x, y) => x.mes.localeCompare(y.mes));
  const porMes = new Map(ordenada.map((p) => [p.mes, p.total]));

  // Tope contra series con fechas corruptas muy antiguas: si el span excede
  // MAX_MESES_RELLENO se descarta el extremo antiguo y se conserva lo reciente
  // (lo reciente es lo que alimenta al modelo).
  const ultimoIndice = indiceMes(ordenada[ordenada.length - 1].mes);
  const primerIndice = indiceMes(ordenada[0].mes);
  const desde = Math.max(primerIndice, ultimoIndice - MAX_MESES_RELLENO + 1);

  const salida: PuntoMes[] = [];
  for (let indice = desde; indice <= ultimoIndice; indice++) {
    const mes = mesDesdeIndice(indice);
    salida.push({ mes, total: porMes.get(mes) ?? 0 });
  }
  return salida;
}

/**
 * Mínimos cuadrados sobre índices 0..n-1:
 *   m = Σ(x−x̄)(y−ȳ) / Σ(x−x̄)² ;  b = ȳ − m·x̄ ;  R² = 1 − SSres/SStot.
 */
function regresionLineal(valores: number[]): { m: number; b: number; r2: number } {
  const n = valores.length;
  const mediaX = (n - 1) / 2;
  const mediaY = valores.reduce((s, y) => s + y, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - mediaX) * (valores[i] - mediaY);
    den += (i - mediaX) ** 2;
  }
  const m = den === 0 ? 0 : num / den;
  const b = mediaY - m * mediaX;
  const ssRes = valores.reduce((s, y, i) => s + (y - (m * i + b)) ** 2, 0);
  const ssTot = valores.reduce((s, y) => s + (y - mediaY) ** 2, 0);
  const r2 = ssTot === 0 ? 0 : Math.max(0, 1 - ssRes / ssTot);
  return { m, b, r2 };
}

/**
 * Proyecta los próximos meses a partir de la serie mensual histórica de meses
 * COMPLETOS (el mes en curso no debe venir: metería una caída falsa).
 * Elige el método según cuánta historia hay y lo declara en el resultado.
 */
export function proyectarSerieMensual(
  historia: PuntoMes[],
  mesesAProyectar: number
): ResultadoProyeccion {
  const serie = rellenarMesesFaltantes(historia);
  const horizonte = Math.max(1, Math.min(12, Math.round(mesesAProyectar)));

  if (serie.length === 0) {
    return {
      proyeccion: [],
      metodo: "promedio-movil",
      confianza: "baja",
      r2: null,
      tendenciaMensualPct: 0,
      mesesUsados: 0,
      nota: "Sin historia de ventas: no es posible proyectar.",
    };
  }

  if (serie.length < MINIMO_REGRESION) return proyectarPromedioMovil(serie, horizonte);
  return proyectarRegresion(serie, horizonte);
}

/** Historia corta: promedio móvil ponderado, proyección plana. */
function proyectarPromedioMovil(serie: PuntoMes[], horizonte: number): ResultadoProyeccion {
  const ventana = serie.slice(-VENTANA_PROMEDIO);
  const nv = ventana.length;

  // Promedio ponderado con peso 1/(1+k), k = meses de antigüedad: el mes más
  // reciente pesa el doble que el anterior (mismo esquema de la referencia).
  let suma = 0;
  let pesos = 0;
  for (let i = 0; i < nv; i++) {
    const antiguedad = nv - 1 - i;
    const peso = 1 / (1 + antiguedad);
    suma += ventana[i].total * peso;
    pesos += peso;
  }
  const base = pesos > 0 ? suma / pesos : 0;

  // Banda por dispersión de la ventana. Si σ = 0 (1 solo mes o meses idénticos)
  // se usa ±20 % del nivel como incertidumbre mínima para no mostrar rango nulo.
  const media = ventana.reduce((s, p) => s + p.total, 0) / nv;
  const varianza = ventana.reduce((s, p) => s + (p.total - media) ** 2, 0) / nv;
  const sigma = Math.sqrt(varianza);
  const banda = sigma > 0 ? Z_95 * sigma : base * 0.2;

  // Tendencia solo informativa (con tan pocos puntos no se usa para proyectar).
  const { m } = nv >= 3 ? regresionLineal(ventana.map((p) => p.total)) : { m: 0 };
  const tendenciaMensualPct = media > 0 ? (m / media) * 100 : 0;

  const proyeccion: PuntoProyeccion[] = [];
  let mes = serie[serie.length - 1].mes;
  for (let i = 0; i < horizonte; i++) {
    mes = mesSiguiente(mes);
    proyeccion.push({
      mes,
      estimado: Math.max(0, Math.round(base)),
      pesimista: Math.max(0, Math.round(base - banda)),
      optimista: Math.max(0, Math.round(base + banda)),
    });
  }

  return {
    proyeccion,
    metodo: "promedio-movil",
    confianza: "baja",
    r2: null,
    tendenciaMensualPct,
    mesesUsados: nv,
    nota: `Historia corta (${serie.length} meses completos): se usó un promedio móvil ponderado de los últimos ${nv} meses, con proyección plana y rango de ±1.96·σ.`,
  };
}

/** Historia suficiente: regresión lineal, con estacionalidad si hay ≥ 24 meses. */
function proyectarRegresion(serie: PuntoMes[], horizonte: number): ResultadoProyeccion {
  // Solo la ventana reciente: la historia vieja (2016...) describe otro nivel
  // de negocio y sesgaría la pendiente.
  const ventana = serie.slice(-VENTANA_REGRESION);
  const nv = ventana.length;
  const valores = ventana.map((p) => p.total);

  // 1. Tendencia por mínimos cuadrados sobre el índice de mes.
  const { m, b, r2 } = regresionLineal(valores);
  const tendencia = (x: number) => m * x + b;

  // 2-3. Estacionalidad aditiva: promedio de residuos por mes calendario.
  // Solo con ≥ 24 meses (2 muestras por mes calendario); si no, factor 0.
  const usarEstacionalidad = nv >= MINIMO_ESTACIONAL;
  const factorEstacional: number[] = new Array(12).fill(0);
  if (usarEstacionalidad) {
    const residuosPorMes: number[][] = Array.from({ length: 12 }, () => []);
    for (let i = 0; i < nv; i++) {
      const mesCalendario = Number(ventana[i].mes.slice(5)) - 1;
      residuosPorMes[mesCalendario].push(valores[i] - tendencia(i));
    }
    for (let mc = 0; mc < 12; mc++) {
      const residuos = residuosPorMes[mc];
      if (residuos.length > 0) {
        factorEstacional[mc] = residuos.reduce((s, r) => s + r, 0) / residuos.length;
      }
    }
  }

  // 5. σ de los residuos del modelo completo (tendencia + estacionalidad):
  // la banda ±1.96·σ aproxima un intervalo del 95 %.
  let sumaCuadrados = 0;
  for (let i = 0; i < nv; i++) {
    const mesCalendario = Number(ventana[i].mes.slice(5)) - 1;
    const ajustado = tendencia(i) + factorEstacional[mesCalendario];
    sumaCuadrados += (valores[i] - ajustado) ** 2;
  }
  const sigma = Math.sqrt(sumaCuadrados / nv);
  const banda = Z_95 * sigma;

  // 4. Proyección de los próximos meses (nunca por debajo de 0).
  const proyeccion: PuntoProyeccion[] = [];
  let mes = ventana[nv - 1].mes;
  for (let i = 1; i <= horizonte; i++) {
    mes = mesSiguiente(mes);
    const mesCalendario = Number(mes.slice(5)) - 1;
    const estimado = tendencia(nv - 1 + i) + factorEstacional[mesCalendario];
    proyeccion.push({
      mes,
      estimado: Math.max(0, Math.round(estimado)),
      pesimista: Math.max(0, Math.round(estimado - banda)),
      optimista: Math.max(0, Math.round(estimado + banda)),
    });
  }

  // Confianza: mismos umbrales de la referencia (R² + tamaño de muestra).
  const confianza: NivelConfianza =
    r2 >= 0.7 && nv >= 24 ? "alta" : r2 >= 0.4 && nv >= 12 ? "media" : "baja";

  const mediaY = valores.reduce((s, y) => s + y, 0) / nv;
  const tendenciaMensualPct = mediaY > 0 ? (m / mediaY) * 100 : 0;

  const metodo: MetodoProyeccion = usarEstacionalidad
    ? "regresion-estacional"
    : "regresion-lineal";
  const nota = usarEstacionalidad
    ? `Regresión lineal sobre los últimos ${nv} meses con ajuste estacional por mes calendario; rango de ±1.96·σ de los residuos (~95 %).`
    : `Regresión lineal sobre los últimos ${nv} meses (se requieren ${MINIMO_ESTACIONAL} para estimar estacionalidad); rango de ±1.96·σ de los residuos (~95 %).`;

  return {
    proyeccion,
    metodo,
    confianza,
    r2,
    tendenciaMensualPct,
    mesesUsados: nv,
    nota,
  };
}
