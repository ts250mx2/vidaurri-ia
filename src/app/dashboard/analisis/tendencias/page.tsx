"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  CalendarRange,
  Clock,
  DollarSign,
  Loader2,
  RefreshCw,
  ShoppingCart,
  Ticket,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { moneda, entero, fechaCorta, hoyISO } from "@/lib/formato";
import {
  SelectorSucursal,
  SUCURSALES,
  type Sucursal,
} from "@/components/dashboard/SelectorSucursal";

// Tendencias de venta (adaptado del reporte de tendencias de kyk): serie por
// día/semana/mes, KPIs del rango, comparativo contra el periodo anterior
// equivalente y detalle por periodo con variación %. Aplica a Matriz y a la
// Bodega Usado vía /api/analisis/tendencias.

// ---------- Tipos (espejo de /api/analisis/tendencias) ----------
type Granularidad = "dia" | "semana" | "mes";
type Metrica = "importe" | "ventas" | "ticket";

interface PuntoSerie {
  periodo: string;
  ventas: number;
  importe: number;
  // true cuando el rango consultado no cubre el periodo completo.
  parcial: boolean;
}

interface PeriodoDestacado {
  periodo: string;
  importe: number;
}

interface DatosTendencias {
  sucursal: string;
  fechaInicio: string;
  fechaFin: string;
  granularidad: Granularidad;
  serie: PuntoSerie[];
  comparativo: {
    periodoAnterior: { fechaInicio: string; fechaFin: string };
    actual: { ventas: number; importe: number };
    anterior: { ventas: number; importe: number };
    variacionImporte: number | null;
    variacionVentas: number | null;
  };
  kpis: {
    importeTotal: number;
    ventasTotales: number;
    ticketPromedio: number;
    promedioPorPeriodo: number;
    mejorPeriodo: PeriodoDestacado | null;
    peorPeriodo: PeriodoDestacado | null;
  };
}

// ---------- Constantes de estilo (lenguaje visual de vidaurri-ia) ----------
const lbl = "text-[10px] font-black text-slate-500 uppercase tracking-widest";
const inputCls =
  "block w-full px-4 py-2.5 bg-white/[0.03] border border-white/10 rounded-xl text-sm font-bold text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-400/25 focus:border-amber-400/60 transition-all";

// Altura en píxeles de la barra más alta. En px (no en %) porque un porcentaje
// dentro de una columna flex sin altura definida colapsa todas las barras.
const ALTO_BARRA_MAX = 190;
// A partir de cuántos periodos se compactan la gráfica y sus etiquetas.
const UMBRAL_SERIE_LARGA = 40;
// Máximo de etiquetas visibles en el eje de la gráfica.
const MAX_ETIQUETAS_EJE = 12;

const MESES_CORTOS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

const NOMBRE_GRANULARIDAD: Record<Granularidad, string> = {
  dia: "día",
  semana: "semana",
  mes: "mes",
};

/** Primer día del mes de hace `mesesAtras` meses, en 'AAAA-MM-DD'. */
function inicioMes(mesesAtras: number): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - mesesAtras);
  return d.toLocaleDateString("sv-SE");
}

/** Etiqueta corta del periodo para el eje de la gráfica y la tabla. */
function etiquetaPeriodo(periodo: string, gran: Granularidad): string {
  if (gran === "mes") {
    const [a, m] = periodo.split("-");
    return `${MESES_CORTOS[Number(m) - 1] ?? m} ${a?.slice(2) ?? ""}`;
  }
  // Día y semana llegan como 'AAAA-MM-DD' (la semana es la fecha de su lunes).
  const [, m, d] = periodo.split("-");
  return `${d}/${m}`;
}

/** Descripción completa del periodo (tooltips y tabla). */
function tituloPeriodo(periodo: string, gran: Granularidad): string {
  if (gran === "mes") return etiquetaPeriodo(periodo, gran);
  if (gran === "semana") return `Semana del ${fechaCorta(periodo)}`;
  return fechaCorta(periodo);
}

function valorMetrica(p: PuntoSerie, metrica: Metrica): number {
  if (metrica === "ventas") return Number(p.ventas) || 0;
  if (metrica === "ticket") return p.ventas > 0 ? p.importe / p.ventas : 0;
  return Number(p.importe) || 0;
}

// ---------- Componentes de apoyo ----------

function BotonesSegmentados<T extends string>({
  opciones,
  valor,
  onCambio,
}: {
  opciones: { valor: T; etiqueta: string; icono: ReactNode }[];
  valor: T;
  onCambio: (valor: T) => void;
}) {
  return (
    <div className="inline-flex items-center gap-1 p-1 bg-white/[0.04] border border-white/10 rounded-xl">
      {opciones.map((o) => (
        <button
          key={o.valor}
          onClick={() => onCambio(o.valor)}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-widest transition-colors whitespace-nowrap",
            valor === o.valor
              ? "bg-amber-500/15 text-amber-300 border border-amber-500/30"
              : "text-slate-400 hover:text-white hover:bg-white/[0.05] border border-transparent"
          )}
        >
          {o.icono}
          {o.etiqueta}
        </button>
      ))}
    </div>
  );
}

/** % de variación con ícono: verde subida, rojo caída, gris sin base o 0. */
function Variacion({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-[11px] font-black text-slate-500">—</span>;
  if (pct === 0) return <span className="text-[11px] font-black text-slate-500">0.0%</span>;
  const sube = pct > 0;
  const Icono = sube ? TrendingUp : TrendingDown;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[11px] font-black whitespace-nowrap",
        sube ? "text-emerald-300" : "text-rose-300"
      )}
    >
      <Icono className="h-3.5 w-3.5" />
      {sube ? "+" : ""}
      {pct.toFixed(1)}%
    </span>
  );
}

function GraficaSerie({
  serie,
  granularidad,
  metrica,
}: {
  serie: PuntoSerie[];
  granularidad: Granularidad;
  metrica: Metrica;
}) {
  if (serie.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-500">
        <BarChart3 className="h-10 w-10" />
        <p className="text-[11px] font-black uppercase tracking-widest">
          Sin ventas en el rango seleccionado
        </p>
      </div>
    );
  }

  const valores = serie.map((p) => valorMetrica(p, metrica));
  const max = Math.max(1, ...valores);
  // En series largas (p. ej. un año por día) solo se etiqueta 1 de cada N periodos.
  const paso = Math.max(1, Math.ceil(serie.length / MAX_ETIQUETAS_EJE));
  const esLarga = serie.length > UMBRAL_SERIE_LARGA;

  // El contenedor con scroll propio evita que las series diarias largas
  // desborden la tarjeta: cada columna conserva un ancho mínimo.
  return (
    <div className="overflow-x-auto">
      <div className={cn("flex items-end", esLarga ? "gap-px" : "gap-1")}>
        {serie.map((p, i) => {
          const valor = valores[i];
          const ticket = p.ventas > 0 ? p.importe / p.ventas : 0;
          return (
            <div
              key={p.periodo}
              className={cn(
                "flex-1 flex flex-col items-center gap-1 group",
                esLarga ? "min-w-[3px]" : "min-w-0"
              )}
            >
              {!esLarga && (
                <span className="text-[9px] font-black text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                  {metrica === "ventas" ? entero(valor) : moneda(valor)}
                </span>
              )}
              <div
                className={cn(
                  "w-full rounded-t bg-gradient-to-t from-amber-600/70 to-amber-400/90 hover:from-amber-500 hover:to-orange-400 transition-colors",
                  p.parcial && "opacity-60"
                )}
                style={{ height: `${Math.max(2, Math.round((valor / max) * ALTO_BARRA_MAX))}px` }}
                title={`${tituloPeriodo(p.periodo, granularidad)}${p.parcial ? " (parcial)" : ""}: ${moneda(p.importe)} · ${entero(p.ventas)} ventas · ticket ${moneda(ticket)}`}
              />
              <span className="h-3 text-[9px] font-black text-slate-500 uppercase whitespace-nowrap">
                {i % paso === 0 ? etiquetaPeriodo(p.periodo, granularidad) : ""}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Página ----------

export default function TendenciasPage() {
  const [sucursal, setSucursal] = useState<Sucursal>("matriz");
  const [fechaInicio, setFechaInicio] = useState(() => inicioMes(11));
  const [fechaFin, setFechaFin] = useState(hoyISO());
  const [granularidad, setGranularidad] = useState<Granularidad>("mes");
  const [metrica, setMetrica] = useState<Metrica>("importe");

  const [datos, setDatos] = useState<DatosTendencias | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  // Token de secuencia: descarta respuestas de peticiones obsoletas si el
  // usuario cambia filtros o sucursal antes de que la anterior responda.
  const peticionRef = useRef(0);

  const cargar = useCallback(
    async (inicio: string, fin: string, gran: Granularidad, suc: Sucursal) => {
      const idPeticion = ++peticionRef.current;
      setCargando(true);
      setError("");
      try {
        const qs = new URLSearchParams({
          fechaInicio: inicio,
          fechaFin: fin,
          granularidad: gran,
        });
        if (suc === "usadas") qs.set("sucursal", "usadas");
        const res = await fetch(`/api/analisis/tendencias?${qs.toString()}`);
        if (idPeticion !== peticionRef.current) return;
        if (res.status === 401) {
          window.location.href = "/login";
          return;
        }
        const json = await res.json();
        if (idPeticion !== peticionRef.current) return;
        if (!res.ok) throw new Error(json.error || "Error al consultar las tendencias");
        setDatos(json);
      } catch (err: unknown) {
        if (idPeticion !== peticionRef.current) return;
        setError(err instanceof Error ? err.message : "Error desconocido");
        setDatos(null);
      } finally {
        if (idPeticion === peticionRef.current) setCargando(false);
      }
    },
    []
  );

  useEffect(() => {
    cargar(inicioMes(11), hoyISO(), "mes", "matriz");
  }, [cargar]);

  const actualizar = () => cargar(fechaInicio, fechaFin, granularidad, sucursal);

  const preset = (mesesAtras: number) => {
    const inicio = inicioMes(mesesAtras);
    const fin = hoyISO();
    setFechaInicio(inicio);
    setFechaFin(fin);
    cargar(inicio, fin, granularidad, sucursal);
  };

  const cambiarGranularidad = (gran: Granularidad) => {
    if (gran === granularidad) return;
    setGranularidad(gran);
    cargar(fechaInicio, fechaFin, gran, sucursal);
  };

  const cambiarSucursal = (nueva: Sucursal) => {
    if (nueva === sucursal) return;
    setSucursal(nueva);
    cargar(fechaInicio, fechaFin, granularidad, nueva);
  };

  const kpis = datos?.kpis ?? null;
  const comparativo = datos?.comparativo ?? null;
  // La serie en pantalla puede ser de una petición anterior: el render usa la
  // granularidad que reporta el payload; el estado `granularidad` queda solo
  // para los botones y la siguiente petición.
  const granRender = datos?.granularidad ?? granularidad;
  const nombreGran = NOMBRE_GRANULARIDAD[granRender];

  const tarjetas = kpis && comparativo
    ? [
        {
          titulo: "Importe del periodo",
          valor: moneda(kpis.importeTotal),
          detalle: `${entero(kpis.ventasTotales)} ventas`,
          color: "text-amber-300",
          icono: null,
        },
        {
          titulo: "Ticket promedio",
          valor: moneda(kpis.ticketPromedio),
          detalle: "importe / ventas",
          color: "text-cyan-300",
          icono: null,
        },
        {
          titulo: "Variación de importe",
          valor:
            comparativo.variacionImporte === null
              ? "—"
              : `${comparativo.variacionImporte > 0 ? "+" : ""}${comparativo.variacionImporte.toFixed(1)}%`,
          detalle: `vs periodo anterior: ${moneda(comparativo.actual.importe - comparativo.anterior.importe)}`,
          color: !comparativo.variacionImporte
            ? "text-slate-400"
            : comparativo.variacionImporte > 0
              ? "text-emerald-300"
              : "text-rose-300",
          icono: !comparativo.variacionImporte ? null : comparativo.variacionImporte > 0 ? (
            <TrendingUp className="h-4 w-4" />
          ) : (
            <TrendingDown className="h-4 w-4" />
          ),
        },
        {
          titulo: `Promedio por ${nombreGran}`,
          valor: moneda(kpis.promedioPorPeriodo),
          detalle: `${entero(datos?.serie.length ?? 0)} periodos con venta`,
          color: "text-violet-300",
          icono: null,
        },
        {
          titulo: `Mejor ${nombreGran}`,
          valor: kpis.mejorPeriodo ? moneda(kpis.mejorPeriodo.importe) : "—",
          detalle: kpis.mejorPeriodo
            ? tituloPeriodo(kpis.mejorPeriodo.periodo, granRender)
            : "sin datos",
          color: "text-emerald-300",
          icono: null,
        },
        {
          titulo: `Peor ${nombreGran}`,
          valor: kpis.peorPeriodo ? moneda(kpis.peorPeriodo.importe) : "—",
          detalle: kpis.peorPeriodo
            ? tituloPeriodo(kpis.peorPeriodo.periodo, granRender)
            : "sin datos",
          color: "text-rose-300",
          icono: null,
        },
      ]
    : [];

  // Detalle por periodo con variación % contra el periodo inmediato anterior de
  // la serie (cronológico); se muestra del más reciente al más antiguo.
  const filasDetalle = (datos?.serie ?? [])
    .map((p, i, arr) => {
      const anterior = i > 0 ? arr[i - 1] : null;
      return {
        ...p,
        ticket: p.ventas > 0 ? p.importe / p.ventas : 0,
        variacion:
          anterior && Number(anterior.importe) > 0
            ? ((p.importe - anterior.importe) / anterior.importe) * 100
            : null,
      };
    })
    .reverse();

  return (
    <div className="space-y-4">
      {/* Encabezado */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight">Tendencias de Venta</h1>
          <p className={cn(lbl, "mt-1")}>
            {cargando
              ? "Consultando..."
              : `Evolución por ${nombreGran} · ${sucursal === "usadas" ? "Bodega Usado" : "Matriz"}`}
          </p>
        </div>
        <SelectorSucursal opciones={SUCURSALES} valor={sucursal} onCambio={cambiarSucursal} />
      </div>

      {/* Filtros */}
      <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-4 backdrop-blur-xl">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <label className={lbl}>Del</label>
            <input
              type="date"
              className={cn(inputCls, "[color-scheme:dark] w-40")}
              value={fechaInicio}
              onChange={(e) => setFechaInicio(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label className={lbl}>Al</label>
            <input
              type="date"
              className={cn(inputCls, "[color-scheme:dark] w-40")}
              value={fechaFin}
              onChange={(e) => setFechaFin(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <span className={lbl}>Granularidad</span>
            <BotonesSegmentados<Granularidad>
              opciones={[
                { valor: "dia", etiqueta: "Día", icono: <Clock className="h-3.5 w-3.5" /> },
                { valor: "semana", etiqueta: "Semana", icono: <CalendarDays className="h-3.5 w-3.5" /> },
                { valor: "mes", etiqueta: "Mes", icono: <CalendarRange className="h-3.5 w-3.5" /> },
              ]}
              valor={granularidad}
              onCambio={cambiarGranularidad}
            />
          </div>
          <button
            onClick={actualizar}
            disabled={cargando}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500 text-slate-950 text-[11px] font-black uppercase tracking-widest hover:brightness-110 transition-all disabled:opacity-40"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", cargando && "animate-spin")} /> Actualizar
          </button>
          <div className="flex items-center gap-1.5">
            {[
              { etiqueta: "Este mes", meses: 0 },
              { etiqueta: "3 meses", meses: 2 },
              { etiqueta: "6 meses", meses: 5 },
              { etiqueta: "12 meses", meses: 11 },
              { etiqueta: "2 años", meses: 23 },
            ].map((p) => (
              <button
                key={p.etiqueta}
                onClick={() => preset(p.meses)}
                className="px-3 py-2 rounded-lg bg-white/[0.05] border border-white/10 text-slate-400 text-[10px] font-black uppercase tracking-widest hover:text-amber-300 transition-all"
              >
                {p.etiqueta}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Error */}
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
            {/* Tarjetas KPI */}
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
              {tarjetas.map((t) => (
                <div
                  key={t.titulo}
                  className="bg-white/[0.04] border border-white/10 rounded-2xl p-4 backdrop-blur-xl"
                >
                  <p className={lbl}>{t.titulo}</p>
                  <p className={cn("flex items-center gap-1.5 text-xl font-black mt-2 truncate", t.color)}>
                    {t.icono}
                    {t.valor}
                  </p>
                  <p className="text-[11px] font-bold text-slate-500 mt-1 truncate">{t.detalle}</p>
                </div>
              ))}
            </div>

            {/* Gráfica principal */}
            <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-4 backdrop-blur-xl">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <p className={lbl}>
                  Evolución por {nombreGran} · del {fechaCorta(datos.fechaInicio)} al{" "}
                  {fechaCorta(datos.fechaFin)}
                </p>
                <BotonesSegmentados<Metrica>
                  opciones={[
                    { valor: "importe", etiqueta: "Importe", icono: <DollarSign className="h-3.5 w-3.5" /> },
                    { valor: "ventas", etiqueta: "Ventas", icono: <ShoppingCart className="h-3.5 w-3.5" /> },
                    { valor: "ticket", etiqueta: "Ticket", icono: <Ticket className="h-3.5 w-3.5" /> },
                  ]}
                  valor={metrica}
                  onCambio={setMetrica}
                />
              </div>
              <GraficaSerie serie={datos.serie} granularidad={granRender} metrica={metrica} />
            </div>

            <div className="grid lg:grid-cols-3 gap-4">
              {/* Comparativo contra el periodo anterior equivalente */}
              {comparativo && (
                <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-4 backdrop-blur-xl space-y-4">
                  <div>
                    <p className={lbl}>Comparativo vs periodo anterior</p>
                    <p className="text-[11px] font-bold text-slate-500 mt-1">
                      Periodo anterior: del {fechaCorta(comparativo.periodoAnterior.fechaInicio)} al{" "}
                      {fechaCorta(comparativo.periodoAnterior.fechaFin)}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[11px] font-bold text-slate-400">Importe actual</span>
                      <span className="text-[13px] font-black text-amber-300">
                        {moneda(comparativo.actual.importe)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[11px] font-bold text-slate-400">Importe anterior</span>
                      <span className="text-[13px] font-black text-slate-300">
                        {moneda(comparativo.anterior.importe)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3 pb-2 border-b border-white/[0.06]">
                      <span className="text-[11px] font-bold text-slate-400">Variación importe</span>
                      <Variacion pct={comparativo.variacionImporte} />
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[11px] font-bold text-slate-400">Ventas actuales</span>
                      <span className="text-[13px] font-black text-amber-300">
                        {entero(comparativo.actual.ventas)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[11px] font-bold text-slate-400">Ventas anteriores</span>
                      <span className="text-[13px] font-black text-slate-300">
                        {entero(comparativo.anterior.ventas)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[11px] font-bold text-slate-400">Variación ventas</span>
                      <Variacion pct={comparativo.variacionVentas} />
                    </div>
                  </div>
                </div>
              )}

              {/* Detalle por periodo */}
              <div className="lg:col-span-2 bg-white/[0.04] border border-white/10 rounded-2xl backdrop-blur-xl overflow-hidden">
                <div className="px-4 pt-4 pb-2">
                  <p className={lbl}>Detalle por {nombreGran}</p>
                </div>
                {filasDetalle.length === 0 ? (
                  <p className="px-4 pb-4 text-[12px] font-bold text-slate-500">
                    Sin ventas en el rango seleccionado.
                  </p>
                ) : (
                  <div className="overflow-auto max-h-[420px]">
                    <table className="w-full">
                      <thead className="sticky top-0 z-10 bg-[#10151f] shadow-[0_1px_0_rgba(255,255,255,0.08)]">
                        <tr>
                          <th className={cn(lbl, "px-4 py-2.5 text-left")}>Periodo</th>
                          <th className={cn(lbl, "px-4 py-2.5 text-right")}>Ventas</th>
                          <th className={cn(lbl, "px-4 py-2.5 text-right")}>Importe</th>
                          <th className={cn(lbl, "px-4 py-2.5 text-right")}>Ticket prom.</th>
                          <th className={cn(lbl, "px-4 py-2.5 text-right")}>Variación</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/[0.04]">
                        {filasDetalle.map((f) => (
                          <tr key={f.periodo} className="hover:bg-white/[0.03] transition-colors">
                            <td className="px-4 py-2.5 text-[12px] font-black text-cyan-300 whitespace-nowrap">
                              {tituloPeriodo(f.periodo, granRender)}
                              {f.parcial && (
                                <span className="text-slate-500 font-bold"> (parcial)</span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-[12px] font-bold text-slate-300 text-right">
                              {entero(f.ventas)}
                            </td>
                            <td className="px-4 py-2.5 text-[12px] font-black text-slate-200 text-right">
                              {moneda(f.importe)}
                            </td>
                            <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400 text-right">
                              {moneda(f.ticket)}
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <Variacion pct={f.variacion} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </>
        )
      )}
    </div>
  );
}
