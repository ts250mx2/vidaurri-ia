"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Info,
  Loader2,
  Minus,
  RefreshCw,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { moneda, entero } from "@/lib/formato";
import {
  SelectorSucursal,
  SUCURSALES,
  type Sucursal,
} from "@/components/dashboard/SelectorSucursal";

// Proyección de ventas: consume /api/analisis/proyeccion, que agrega la serie
// mensual histórica (Matriz: bdav desde 2016; Bodega Usado: desde dic-2024) y
// la proyecta con regresión lineal + estacionalidad. Con poca historia el
// método se degrada y llega declarado en la respuesta (metodo/nota).

interface MesHistoria {
  mes: string;
  ventas: number;
  total: number;
}

interface MesProyeccion {
  mes: string;
  estimado: number;
  pesimista: number;
  optimista: number;
}

type Metodo = "regresion-estacional" | "regresion-lineal" | "promedio-movil";
type Confianza = "alta" | "media" | "baja";

interface DatosProyeccion {
  sucursal: string;
  mesesProyectados: number;
  historia: MesHistoria[];
  mesEnCurso: MesHistoria | null;
  proyeccion: MesProyeccion[];
  metodo: Metodo;
  confianza: Confianza;
  r2: number | null;
  tendenciaMensualPct: number;
  mesesUsados: number;
  nota: string;
}

const lbl = "text-[10px] font-black text-slate-500 uppercase tracking-widest";
const tarjeta = "bg-white/[0.04] border border-white/10 rounded-2xl p-4 backdrop-blur-xl";

const OPCIONES_MESES = [3, 6, 9, 12];

const METODO_ETIQUETA: Record<Metodo, string> = {
  "regresion-estacional": "Regresión + estacionalidad",
  "regresion-lineal": "Regresión lineal",
  "promedio-movil": "Promedio móvil",
};

const CONFIANZA_COLOR: Record<Confianza, string> = {
  alta: "text-emerald-300",
  media: "text-amber-300",
  baja: "text-rose-300",
};

const MESES_CORTOS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

/** 'AAAA-MM' → 'Mes AA' (p.ej. '2026-09' → 'Sep 26'). */
function etiquetaMes(mes: string): string {
  const [a, m] = mes.split("-");
  const nombre = MESES_CORTOS[Number(m) - 1] ?? mes;
  return `${nombre} ${a?.slice(2) ?? ""}`;
}

// Alto en píxeles del área de dibujo y de la barra más alta. Las barras se
// dimensionan en px calculados en JS (patrón GraficaMeses del panel principal):
// un height en % dentro de una columna flex sin altura definida colapsa.
const ALTO_AREA = 190;
const ALTO_BARRA_MAX = 172;

function GraficaProyeccion({
  historia,
  proyeccion,
}: {
  historia: MesHistoria[];
  proyeccion: MesProyeccion[];
}) {
  // Con horizontes largos se recorta la historia para que quepan las columnas.
  const numHistoria = proyeccion.length >= 9 ? 12 : 15;
  const visibles = historia.slice(-numHistoria);
  const maxValor = Math.max(
    1,
    ...visibles.map((h) => h.total),
    ...proyeccion.map((p) => p.optimista)
  );
  const px = (v: number) => Math.max(2, Math.round((v / maxValor) * ALTO_BARRA_MAX));

  return (
    <div className={tarjeta}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <p className={lbl}>Historia mensual y proyección</p>
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex items-center gap-1.5 text-[9px] font-black text-slate-400 uppercase tracking-widest">
            <span className="inline-block w-3 h-3 rounded-sm bg-gradient-to-t from-amber-600/70 to-amber-400/90" />
            Historia
          </span>
          <span className="flex items-center gap-1.5 text-[9px] font-black text-slate-400 uppercase tracking-widest">
            <span className="inline-block w-3 h-3 rounded-sm border-2 border-dashed border-amber-400/60 bg-amber-400/10" />
            Proyección
          </span>
          <span className="flex items-center gap-1.5 text-[9px] font-black text-slate-400 uppercase tracking-widest">
            <span className="inline-block w-[3px] h-3 rounded-full bg-cyan-300/60" />
            Rango 95 %
          </span>
        </div>
      </div>

      <div className="flex items-end gap-1.5 sm:gap-2">
        {visibles.map((h) => (
          <div key={h.mes} className="flex-1 min-w-0 flex flex-col items-center gap-1 group">
            <div className="relative w-full" style={{ height: ALTO_AREA }}>
              <span
                className="absolute left-1/2 -translate-x-1/2 text-[9px] font-black text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none"
                style={{ bottom: px(h.total) + 4 }}
              >
                {moneda(h.total)}
              </span>
              <div
                className="absolute bottom-0 left-0 right-0 rounded-t-lg bg-gradient-to-t from-amber-600/70 to-amber-400/90 hover:from-amber-500 hover:to-orange-400 transition-colors"
                style={{ height: px(h.total) }}
                title={`${h.mes}: ${moneda(h.total)} (${entero(h.ventas)} ventas)`}
              />
            </div>
            <span className="text-[9px] font-black text-slate-500 uppercase whitespace-nowrap">
              {etiquetaMes(h.mes)}
            </span>
          </div>
        ))}

        {/* Separador entre lo real y lo estimado */}
        <div className="self-stretch border-l border-dashed border-white/20" />

        {proyeccion.map((p) => (
          <div key={p.mes} className="flex-1 min-w-0 flex flex-col items-center gap-1 group">
            <div className="relative w-full" style={{ height: ALTO_AREA }}>
              <span
                className="absolute left-1/2 -translate-x-1/2 text-[9px] font-black text-amber-200 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none"
                style={{ bottom: px(p.optimista) + 4 }}
              >
                {moneda(p.estimado)}
              </span>
              {/* Barra proyectada: punteada y translúcida para distinguirla de la historia */}
              <div
                className="absolute bottom-0 left-0 right-0 rounded-t-lg border-2 border-dashed border-amber-400/60 bg-amber-400/10 group-hover:bg-amber-400/20 transition-colors"
                style={{ height: px(p.estimado) }}
                title={`${p.mes}: ${moneda(p.estimado)} (rango ${moneda(p.pesimista)} – ${moneda(p.optimista)})`}
              />
              {/* Rango pesimista-optimista (~95 %) */}
              <div
                className="absolute left-1/2 -translate-x-1/2 w-[3px] rounded-full bg-cyan-300/60 pointer-events-none"
                style={{
                  bottom: px(p.pesimista),
                  height: Math.max(2, px(p.optimista) - px(p.pesimista)),
                }}
              />
            </div>
            <span className="text-[9px] font-black text-amber-300/80 uppercase whitespace-nowrap">
              {etiquetaMes(p.mes)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ProyeccionPage() {
  const [sucursal, setSucursal] = useState<Sucursal>("matriz");
  const [meses, setMeses] = useState(6);
  const [datos, setDatos] = useState<DatosProyeccion | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  // Token de secuencia: descarta respuestas de cargas viejas al cambiar filtros.
  const secuenciaRef = useRef(0);

  const cargar = useCallback(async (suc: Sucursal, numMeses: number) => {
    const secuencia = ++secuenciaRef.current;
    setCargando(true);
    setError("");
    try {
      const qs = new URLSearchParams({ meses: String(numMeses) });
      if (suc === "usadas") qs.set("sucursal", "usadas");
      const res = await fetch(`/api/analisis/proyeccion?${qs.toString()}`);
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      const json = await res.json();
      if (secuencia !== secuenciaRef.current) return;
      if (!res.ok) throw new Error(json.error || "Error al calcular la proyección");
      setDatos(json);
    } catch (err: unknown) {
      if (secuencia !== secuenciaRef.current) return;
      setError(err instanceof Error ? err.message : "Error desconocido");
      setDatos(null);
    } finally {
      if (secuencia === secuenciaRef.current) setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar(sucursal, meses);
  }, [cargar, sucursal, meses]);

  // Derivados para los KPIs.
  const proximo = datos?.proyeccion[0] ?? null;
  const totalEstimado = datos?.proyeccion.reduce((s, p) => s + p.estimado, 0) ?? 0;
  const totalPesimista = datos?.proyeccion.reduce((s, p) => s + p.pesimista, 0) ?? 0;
  const totalOptimista = datos?.proyeccion.reduce((s, p) => s + p.optimista, 0) ?? 0;
  const tendencia = datos?.tendenciaMensualPct ?? 0;
  const IconoTendencia = tendencia > 0.5 ? TrendingUp : tendencia < -0.5 ? TrendingDown : Minus;
  const colorTendencia =
    tendencia > 0.5 ? "text-emerald-300" : tendencia < -0.5 ? "text-rose-300" : "text-slate-300";

  return (
    <div className="space-y-4">
      {/* Encabezado */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight">Proyección de Ventas</h1>
          <p className={cn(lbl, "mt-1")}>
            {cargando
              ? "Calculando..."
              : sucursal === "usadas"
                ? "Estimación estadística — Bodega Usado"
                : "Estimación estadística — Auto Partes Vidaurri"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <SelectorSucursal opciones={SUCURSALES} valor={sucursal} onCambio={setSucursal} />
          {/* Selector de meses a proyectar */}
          <div className="inline-flex items-center gap-1 p-1 bg-white/[0.04] border border-white/10 rounded-xl">
            {OPCIONES_MESES.map((n) => (
              <button
                key={n}
                onClick={() => setMeses(n)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-widest transition-colors whitespace-nowrap",
                  meses === n
                    ? "bg-amber-500/15 text-amber-300 border border-amber-500/30"
                    : "text-slate-400 hover:text-white hover:bg-white/[0.05] border border-transparent"
                )}
              >
                {n} m
              </button>
            ))}
          </div>
          <button
            onClick={() => cargar(sucursal, meses)}
            disabled={cargando}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/[0.05] border border-white/10 text-slate-300 text-[11px] font-black uppercase tracking-widest hover:text-amber-300 transition-all disabled:opacity-40"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", cargando && "animate-spin")} /> Actualizar
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-rose-300 text-[11px] font-black bg-rose-500/10 p-3 rounded-xl border border-rose-500/25 uppercase tracking-wider">
          <AlertTriangle className="h-4 w-4" /> {error}
        </div>
      )}

      {cargando && !datos ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 text-amber-400 animate-spin" />
        </div>
      ) : (
        datos && (
          <>
            {datos.proyeccion.length === 0 ? (
              <div className={tarjeta}>
                <p className="text-[12px] font-bold text-slate-400">
                  No hay historia suficiente para calcular una proyección.
                </p>
              </div>
            ) : (
              <>
                {/* KPIs */}
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <div className={tarjeta}>
                    <p className={lbl}>Proyección {proximo ? etiquetaMes(proximo.mes) : ""}</p>
                    <p className="text-xl font-black mt-2 truncate text-amber-300">
                      {moneda(proximo?.estimado ?? 0)}
                    </p>
                    <p className="text-[11px] font-bold text-slate-500 mt-1 truncate">
                      rango {moneda(proximo?.pesimista ?? 0)} – {moneda(proximo?.optimista ?? 0)}
                    </p>
                  </div>
                  <div className={tarjeta}>
                    <p className={lbl}>Total {datos.mesesProyectados} meses</p>
                    <p className="text-xl font-black mt-2 truncate text-cyan-300">
                      {moneda(totalEstimado)}
                    </p>
                    <p className="text-[11px] font-bold text-slate-500 mt-1 truncate">
                      rango {moneda(totalPesimista)} – {moneda(totalOptimista)}
                    </p>
                  </div>
                  <div className={tarjeta}>
                    <p className={lbl}>Tendencia mensual</p>
                    <p className={cn("text-xl font-black mt-2 truncate flex items-center gap-2", colorTendencia)}>
                      <IconoTendencia className="h-5 w-5 shrink-0" />
                      {tendencia >= 0 ? "+" : ""}
                      {tendencia.toFixed(1)}%
                    </p>
                    <p className="text-[11px] font-bold text-slate-500 mt-1 truncate">
                      pendiente sobre el nivel promedio
                    </p>
                  </div>
                  <div className={tarjeta}>
                    <p className={lbl}>Confianza del modelo</p>
                    <p className={cn("text-xl font-black mt-2 truncate uppercase", CONFIANZA_COLOR[datos.confianza])}>
                      {datos.confianza}
                    </p>
                    <p className="text-[11px] font-bold text-slate-500 mt-1 truncate">
                      {METODO_ETIQUETA[datos.metodo]}
                      {datos.r2 != null ? ` · R² ${datos.r2.toFixed(2)}` : ""} · {entero(datos.mesesUsados)} meses
                    </p>
                  </div>
                </div>

                {/* Gráfica combinada */}
                <GraficaProyeccion historia={datos.historia} proyeccion={datos.proyeccion} />

                {datos.mesEnCurso && (
                  <p className="text-[11px] font-bold text-slate-500 px-1">
                    Mes en curso ({etiquetaMes(datos.mesEnCurso.mes)}): {moneda(datos.mesEnCurso.total)} en{" "}
                    {entero(datos.mesEnCurso.ventas)} ventas al corte — no entra al modelo por estar incompleto.
                  </p>
                )}

                {/* Tabla de meses proyectados */}
                <div className="bg-white/[0.04] border border-white/10 rounded-2xl backdrop-blur-xl overflow-hidden">
                  <div className="px-4 pt-4 pb-2">
                    <p className={lbl}>Meses proyectados</p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-[#10151f]">
                        <tr>
                          <th className={cn(lbl, "px-4 py-2.5 text-left")}>Mes</th>
                          <th className={cn(lbl, "px-4 py-2.5 text-right")}>Estimado</th>
                          <th className={cn(lbl, "px-4 py-2.5 text-right")}>Pesimista</th>
                          <th className={cn(lbl, "px-4 py-2.5 text-right")}>Optimista</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/[0.04]">
                        {datos.proyeccion.map((p) => (
                          <tr key={p.mes} className="hover:bg-white/[0.03] transition-colors">
                            <td className="px-4 py-2.5 text-[12px] font-black text-amber-300 whitespace-nowrap">
                              {etiquetaMes(p.mes)}
                            </td>
                            <td className="px-4 py-2.5 text-[12px] font-black text-slate-200 text-right">
                              {moneda(p.estimado)}
                            </td>
                            <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400 text-right">
                              {moneda(p.pesimista)}
                            </td>
                            <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400 text-right">
                              {moneda(p.optimista)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="bg-[#10151f]">
                          <td className={cn(lbl, "px-4 py-2.5 text-left")}>Total</td>
                          <td className="px-4 py-2.5 text-[12px] font-black text-amber-300 text-right">
                            {moneda(totalEstimado)}
                          </td>
                          <td className="px-4 py-2.5 text-[12px] font-black text-slate-300 text-right">
                            {moneda(totalPesimista)}
                          </td>
                          <td className="px-4 py-2.5 text-[12px] font-black text-slate-300 text-right">
                            {moneda(totalOptimista)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              </>
            )}

            {/* Nota metodológica */}
            <div className="flex items-start gap-2 text-[11px] font-bold text-slate-400 bg-white/[0.03] border border-white/10 rounded-xl p-3">
              <Info className="h-4 w-4 text-amber-300 shrink-0 mt-0.5" />
              <p>
                <span className="text-slate-300">Estimación estadística.</span> La proyección se calcula
                únicamente a partir del comportamiento histórico mensual de ventas; no considera promociones,
                cambios de precios ni eventos externos. Úsala como referencia, no como compromiso de venta.{" "}
                {datos.nota}
              </p>
            </div>
          </>
        )
      )}
    </div>
  );
}
