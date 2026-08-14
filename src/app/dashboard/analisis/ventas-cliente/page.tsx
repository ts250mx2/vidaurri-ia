"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ListRestart,
  Loader2,
  RefreshCw,
  Search,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { moneda, entero, fechaCorta, hoyISO } from "@/lib/formato";
import {
  SelectorSucursal,
  SUCURSALES,
  type Sucursal,
} from "@/components/dashboard/SelectorSucursal";

// Ventas por Cliente: ranking del rango por importe con participación %,
// acumulado tipo Pareto, frecuencia de compra y ticket promedio. Adaptación
// del reporte de clientes de kyk al lenguaje visual de vidaurri-ia.

// ---------- Tipos (espejo de /api/analisis/ventas-cliente) ----------
interface ClienteRanking {
  posicion: number;
  cliente: string;
  compras: number;
  piezas: number;
  importe: number;
  ticketPromedio: number;
  participacion: number;
  acumulado: number;
  ultimaCompra: string;
}

interface Kpis {
  clientes: number;
  compras: number;
  piezas: number;
  importe: number;
  ticketPromedio: number;
  top10Pct: number;
}

interface Respuesta {
  fechaInicio: string;
  fechaFin: string;
  busqueda: string;
  kpis: Kpis;
  totalClientes: number;
  clientes: ClienteRanking[];
}

// ---------- Constantes de estilo (lenguaje visual de vidaurri-ia) ----------
const lbl = "text-[10px] font-black text-slate-500 uppercase tracking-widest";
const inputCls =
  "block w-full px-4 py-2.5 bg-white/[0.03] border border-white/10 rounded-xl text-sm font-bold text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-400/25 focus:border-amber-400/60 transition-all";

/** Corte clásico de Pareto: los clientes dentro del 80% acumulado se resaltan. */
const CORTE_PARETO = 80;

const mesesAtras = (n: number) => {
  const d = new Date();
  // Normalizar al día 1 ANTES de restar meses: sin esto setMonth desborda en
  // fin de mes (31 mayo − 3 meses → 3 de marzo). Mismo patrón que inicioMes
  // de la página de tendencias.
  d.setDate(1);
  d.setMonth(d.getMonth() - n);
  return d.toLocaleDateString("sv-SE");
};

const pct = (n: number) => `${(Number(n) || 0).toFixed(1)}%`;

export default function VentasClientePage() {
  const [sucursal, setSucursal] = useState<Sucursal>("matriz");
  const [fechaInicio, setFechaInicio] = useState(mesesAtras(12));
  const [fechaFin, setFechaFin] = useState(hoyISO());
  const [busqueda, setBusqueda] = useState("");

  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  // Token de secuencia: descarta respuestas de peticiones obsoletas (el usuario
  // cambió filtros o sucursal antes de que respondiera la anterior).
  const peticionRef = useRef(0);

  const cargar = useCallback(
    async (inicio: string, fin: string, filtro: string, suc: Sucursal) => {
      const idPeticion = ++peticionRef.current;
      setCargando(true);
      setError("");
      try {
        const qs = new URLSearchParams({ fechaInicio: inicio, fechaFin: fin });
        if (suc === "usadas") qs.set("sucursal", "usadas");
        if (filtro) qs.set("busqueda", filtro);
        const res = await fetch(`/api/analisis/ventas-cliente?${qs.toString()}`);
        if (idPeticion !== peticionRef.current) return;
        if (res.status === 401) {
          window.location.href = "/login";
          return;
        }
        const json = await res.json();
        if (idPeticion !== peticionRef.current) return;
        if (!res.ok) throw new Error(json.error || "Error al consultar el análisis");
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
    cargar(mesesAtras(12), hoyISO(), "", "matriz");
  }, [cargar]);

  const actualizar = () => cargar(fechaInicio, fechaFin, busqueda, sucursal);

  const preset = (meses: number) => {
    const inicio = mesesAtras(meses);
    const fin = hoyISO();
    setFechaInicio(inicio);
    setFechaFin(fin);
    cargar(inicio, fin, busqueda, sucursal);
  };

  const limpiar = () => {
    const inicio = mesesAtras(12);
    const fin = hoyISO();
    setFechaInicio(inicio);
    setFechaFin(fin);
    setBusqueda("");
    cargar(inicio, fin, "", sucursal);
  };

  const cambiarSucursal = (nueva: Sucursal) => {
    if (nueva === sucursal) return;
    setSucursal(nueva);
    cargar(fechaInicio, fechaFin, busqueda, nueva);
  };

  const kpis = datos?.kpis;
  const tarjetas = kpis
    ? [
        {
          titulo: "Clientes con compras",
          valor: entero(kpis.clientes),
          detalle: "en el rango",
          color: "text-cyan-300",
        },
        {
          titulo: "Importe del rango",
          valor: moneda(kpis.importe),
          detalle: `${entero(kpis.compras)} compras`,
          color: "text-amber-300",
        },
        {
          titulo: "Ticket promedio",
          valor: moneda(kpis.ticketPromedio),
          detalle: "por compra",
          color: "text-emerald-300",
        },
        {
          titulo: "Piezas vendidas",
          valor: entero(kpis.piezas),
          detalle: "en el rango",
          color: "text-violet-300",
        },
        {
          titulo: "Top 10 concentra",
          valor: pct(kpis.top10Pct),
          detalle: "del importe del rango",
          color: "text-rose-300",
        },
      ]
    : [];

  // Escala de las barras: relativa al cliente más grande de lo mostrado para
  // que la barra mayor ocupe todo el ancho. El width en % sí funciona aquí
  // porque el contenedor de la barra tiene ancho fijo (w-24).
  const clientes = datos?.clientes ?? [];
  const maxParticipacion = clientes.reduce((m, c) => Math.max(m, c.participacion), 0);

  return (
    <div className="space-y-4">
      {/* Encabezado */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight">Ventas por Cliente</h1>
          <p className={cn(lbl, "mt-1")}>
            {cargando
              ? "Consultando..."
              : datos
                ? `${entero(datos.totalClientes)} clientes · ranking por importe del rango`
                : "Ranking por importe del rango"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <SelectorSucursal opciones={SUCURSALES} valor={sucursal} onCambio={cambiarSucursal} />
          <button
            onClick={actualizar}
            disabled={cargando}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/[0.05] border border-white/10 text-slate-300 text-[11px] font-black uppercase tracking-widest hover:text-amber-300 transition-all disabled:opacity-40"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", cargando && "animate-spin")} /> Actualizar
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-4 backdrop-blur-xl space-y-3">
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
          <button
            onClick={actualizar}
            disabled={cargando}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500 text-slate-950 text-[11px] font-black uppercase tracking-widest hover:brightness-110 transition-all disabled:opacity-40"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", cargando && "animate-spin")} /> Aplicar
          </button>
          <div className="flex items-center gap-1.5">
            {[
              { etiqueta: "3 meses", meses: 3 },
              { etiqueta: "6 meses", meses: 6 },
              { etiqueta: "12 meses", meses: 12 },
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
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute top-1/2 -translate-y-1/2 left-3.5 h-4 w-4 text-slate-500" />
            <input
              type="text"
              className={cn(inputCls, "pl-10")}
              placeholder="Buscar cliente en el ranking..."
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && actualizar()}
            />
          </div>
          <button
            onClick={limpiar}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/[0.05] border border-white/10 text-slate-400 text-[11px] font-black uppercase tracking-widest hover:text-white transition-all"
          >
            <ListRestart className="h-3.5 w-3.5" /> Limpiar
          </button>
        </div>
      </div>

      {/* Tarjetas KPI */}
      {kpis && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {tarjetas.map((t) => (
            <div
              key={t.titulo}
              className="bg-white/[0.04] border border-white/10 rounded-2xl p-4 backdrop-blur-xl"
            >
              <p className={lbl}>{t.titulo}</p>
              <p className={cn("text-xl font-black mt-2 truncate", t.color)}>{t.valor}</p>
              <p className="text-[11px] font-bold text-slate-500 mt-1 truncate">{t.detalle}</p>
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 text-rose-300 text-[11px] font-black bg-rose-500/10 p-3 rounded-xl border border-rose-500/25 uppercase tracking-wider">
          <AlertTriangle className="h-4 w-4" /> {error}
        </div>
      )}

      {/* Tabla de ranking */}
      <div className="bg-white/[0.04] border border-white/10 rounded-2xl backdrop-blur-xl overflow-hidden">
        {cargando ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-8 w-8 text-amber-400 animate-spin" />
          </div>
        ) : clientes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3 text-slate-500">
            <Users className="h-10 w-10" />
            <p className="text-[11px] font-black uppercase tracking-widest">
              Sin clientes con ventas en el rango
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-auto max-h-[calc(100vh-24rem)]">
              <table className="w-full">
                <thead className="sticky top-0 z-10 bg-[#10151f] shadow-[0_1px_0_rgba(255,255,255,0.08)]">
                  <tr>
                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>#</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Cliente</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Compras</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Piezas</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Ticket prom.</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Importe</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Participación</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-center")}>Acumulado</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Última compra</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {clientes.map((c) => {
                    const enPareto = c.acumulado <= CORTE_PARETO;
                    return (
                      <tr
                        key={`${c.posicion}-${c.cliente}`}
                        className={cn(
                          "transition-colors hover:bg-white/[0.03]",
                          enPareto && "bg-amber-500/[0.04]"
                        )}
                      >
                        <td className="px-4 py-2.5 text-[12px] font-black text-slate-500 text-right">
                          {entero(c.posicion)}
                        </td>
                        <td className="px-4 py-2.5 text-[12px] font-bold text-slate-300 max-w-[260px] truncate">
                          {c.cliente}
                        </td>
                        <td className="px-4 py-2.5 text-[12px] font-black text-slate-200 text-right">
                          {entero(c.compras)}
                        </td>
                        <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400 text-right">
                          {entero(c.piezas)}
                        </td>
                        <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400 text-right">
                          {moneda(c.ticketPromedio)}
                        </td>
                        <td className="px-4 py-2.5 text-[12px] font-black text-amber-300 text-right">
                          {moneda(c.importe)}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            {/* Contenedor de ancho fijo: el width en % de la barra
                                interior sí se resuelve contra este ancho. */}
                            <div className="w-24 h-2 rounded-full bg-white/[0.06] overflow-hidden shrink-0">
                              <div
                                className="h-full rounded-full bg-gradient-to-r from-amber-600/80 to-amber-400"
                                style={{
                                  width: `${
                                    maxParticipacion > 0
                                      ? Math.max(2, (c.participacion / maxParticipacion) * 100)
                                      : 0
                                  }%`,
                                }}
                              />
                            </div>
                            <span className="text-[11px] font-black text-slate-300 whitespace-nowrap">
                              {pct(c.participacion)}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <span
                            className={cn(
                              "text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-lg border whitespace-nowrap",
                              enPareto
                                ? "text-amber-300 bg-amber-500/10 border-amber-500/25"
                                : "text-slate-400 bg-white/[0.04] border-white/10"
                            )}
                          >
                            {pct(c.acumulado)}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400 whitespace-nowrap">
                          {fechaCorta(c.ultimaCompra)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pie: alcance del listado y leyenda del corte de Pareto */}
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-t border-white/[0.06]">
              <span className={lbl}>
                Mostrando {entero(clientes.length)} de {entero(datos?.totalClientes ?? 0)} clientes
                {(datos?.totalClientes ?? 0) > clientes.length ? " (top 100 por importe)" : ""}
              </span>
              <span className={lbl}>
                <span className="text-amber-300">■</span> Clientes dentro del {CORTE_PARETO}% acumulado
                (corte de Pareto)
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
