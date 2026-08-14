"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { moneda, entero } from "@/lib/formato";
import { Treemap } from "@/components/dashboard/Treemap";
import { SelectorSucursal, SUCURSALES, type Sucursal } from "@/components/dashboard/SelectorSucursal";

interface Grupo {
  id: number;
  nombre: string;
  importe: number;
  piezas: number;
}

interface ProductoDetalle {
  nombre: string;
  descripcion: string;
  importe: number;
  piezas: number;
}

const lbl = "text-[10px] font-black text-slate-500 uppercase tracking-widest";
const inputCls =
  "block w-full px-4 py-2.5 bg-white/[0.03] border border-white/10 rounded-xl text-sm font-bold text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-400/25 focus:border-amber-400/60 transition-all";

const MAX_RECTANGULOS = 24; // el resto se agrupa en "Otros"

const hoyISO = () => new Date().toLocaleDateString("sv-SE");
const inicioMes = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
};
const diasAtras = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString("sv-SE");
};
const inicioAnio = () => `${new Date().getFullYear()}-01-01`;

export function VistaDesglose({
  por,
  titulo,
  etiquetaGrupo,
}: {
  por: "parte" | "linea";
  titulo: string;
  etiquetaGrupo: string;
}) {
  const [sucursal, setSucursal] = useState<Sucursal>("matriz");
  const [fechaInicio, setFechaInicio] = useState(inicioMes());
  const [fechaFin, setFechaFin] = useState(hoyISO());
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [totalImporte, setTotalImporte] = useState(0);
  const [totalPiezas, setTotalPiezas] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const peticionRef = useRef(0);

  // Modal de detalle de un grupo (productos de esa parte/línea).
  const [grupoAbierto, setGrupoAbierto] = useState<Grupo | null>(null);
  const [detalle, setDetalle] = useState<ProductoDetalle[]>([]);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);
  const peticionDetalleRef = useRef(0);

  const cargar = useCallback(
    async (suc: Sucursal, inicio: string, fin: string) => {
      const idPeticion = ++peticionRef.current;
      setCargando(true);
      setError("");
      try {
        const qs = new URLSearchParams({ por, sucursal: suc, fechaInicio: inicio, fechaFin: fin });
        const res = await fetch(`/api/ventas/desglose?${qs.toString()}`);
        if (idPeticion !== peticionRef.current) return;
        if (res.status === 401) {
          window.location.href = "/login";
          return;
        }
        const json = await res.json();
        if (idPeticion !== peticionRef.current) return;
        if (!res.ok) throw new Error(json.error || "Error al consultar el desglose");
        setGrupos(json.grupos);
        setTotalImporte(json.totalImporte);
        setTotalPiezas(json.totalPiezas);
      } catch (err: unknown) {
        if (idPeticion !== peticionRef.current) return;
        setError(err instanceof Error ? err.message : "Error desconocido");
        setGrupos([]);
        setTotalImporte(0);
        setTotalPiezas(0);
      } finally {
        if (idPeticion === peticionRef.current) setCargando(false);
      }
    },
    [por]
  );

  useEffect(() => {
    cargar("matriz", inicioMes(), hoyISO());
  }, [cargar]);

  const actualizar = () => cargar(sucursal, fechaInicio, fechaFin);
  const cambiarSucursal = (s: Sucursal) => {
    setSucursal(s);
    cargar(s, fechaInicio, fechaFin);
  };
  const preset = (inicio: string) => {
    const fin = hoyISO();
    setFechaInicio(inicio);
    setFechaFin(fin);
    cargar(sucursal, inicio, fin);
  };

  const abrirGrupo = useCallback(
    async (nombre: string) => {
      const grupo = grupos.find((g) => g.nombre === nombre);
      if (!grupo) return; // "Otros" u otro agregado sin id: no tiene detalle
      const idPeticion = ++peticionDetalleRef.current;
      setGrupoAbierto(grupo);
      setDetalle([]);
      setCargandoDetalle(true);
      try {
        const qs = new URLSearchParams({
          por,
          sucursal,
          fechaInicio,
          fechaFin,
          id: String(grupo.id),
        });
        const res = await fetch(`/api/ventas/desglose?${qs.toString()}`);
        if (idPeticion !== peticionDetalleRef.current) return;
        if (res.status === 401) {
          window.location.href = "/login";
          return;
        }
        const json = await res.json();
        if (idPeticion !== peticionDetalleRef.current) return;
        if (!res.ok) throw new Error(json.error || "Error al consultar el detalle");
        setDetalle(json.detalle);
      } catch (err: unknown) {
        if (idPeticion !== peticionDetalleRef.current) return;
        setError(err instanceof Error ? err.message : "Error desconocido");
        setGrupoAbierto(null);
      } finally {
        if (idPeticion === peticionDetalleRef.current) setCargandoDetalle(false);
      }
    },
    [grupos, por, sucursal, fechaInicio, fechaFin]
  );

  const cerrarGrupo = () => {
    peticionDetalleRef.current++;
    setGrupoAbierto(null);
    setDetalle([]);
  };

  // Para el treemap: top N + "Otros" con la suma del resto ("Otros" no es clicable).
  const datosTreemap = (() => {
    if (grupos.length <= MAX_RECTANGULOS) return grupos;
    const top = grupos.slice(0, MAX_RECTANGULOS);
    const resto = grupos.slice(MAX_RECTANGULOS);
    return [
      ...top,
      {
        id: -1,
        nombre: "Otros",
        importe: resto.reduce((s, g) => s + g.importe, 0),
        piezas: resto.reduce((s, g) => s + g.piezas, 0),
      },
    ];
  })();

  const totalGrupoAbierto = detalle.reduce((s, d) => s + d.importe, 0);
  // El treemap del modal también agrupa la cola en "Otros" para leerse bien.
  const datosTreemapDetalle = (() => {
    const items = detalle.map((d) => ({ nombre: d.nombre, importe: d.importe, piezas: d.piezas }));
    if (items.length <= MAX_RECTANGULOS) return items;
    const top = items.slice(0, MAX_RECTANGULOS);
    const resto = items.slice(MAX_RECTANGULOS);
    return [
      ...top,
      {
        nombre: `Otros (${resto.length})`,
        importe: resto.reduce((s, g) => s + g.importe, 0),
        piezas: resto.reduce((s, g) => s + g.piezas, 0),
      },
    ];
  })();

  return (
    <div className="space-y-4">
      {/* Encabezado */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight">{titulo}</h1>
          <p className={cn(lbl, "mt-1")}>
            {cargando
              ? "Consultando..."
              : `${entero(grupos.length)} ${etiquetaGrupo.toLowerCase()}s · ${moneda(totalImporte)}`}
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
          <button
            onClick={actualizar}
            disabled={cargando}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500 text-slate-950 text-[11px] font-black uppercase tracking-widest hover:brightness-110 transition-all disabled:opacity-40"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", cargando && "animate-spin")} /> Actualizar
          </button>
          <div className="flex items-center gap-1.5">
            {[
              { etiqueta: "Este mes", inicio: inicioMes() },
              { etiqueta: "30 días", inicio: diasAtras(30) },
              { etiqueta: "90 días", inicio: diasAtras(90) },
              { etiqueta: "Este año", inicio: inicioAnio() },
            ].map((p) => (
              <button
                key={p.etiqueta}
                onClick={() => preset(p.inicio)}
                className="px-3 py-2 rounded-lg bg-white/[0.05] border border-white/10 text-slate-400 text-[10px] font-black uppercase tracking-widest hover:text-amber-300 transition-all"
              >
                {p.etiqueta}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Resumen */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-4 backdrop-blur-xl">
          <p className={lbl}>Importe total</p>
          <p className="text-xl font-black mt-2 truncate text-amber-300">{moneda(totalImporte)}</p>
        </div>
        <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-4 backdrop-blur-xl">
          <p className={lbl}>Piezas vendidas</p>
          <p className="text-xl font-black mt-2 truncate text-cyan-300">{entero(totalPiezas)}</p>
        </div>
        <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-4 backdrop-blur-xl">
          <p className={lbl}>{etiquetaGrupo}s con venta</p>
          <p className="text-xl font-black mt-2 truncate text-slate-200">{entero(grupos.length)}</p>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-rose-300 text-[11px] font-black bg-rose-500/10 p-3 rounded-xl border border-rose-500/25 uppercase tracking-wider">
          <AlertTriangle className="h-4 w-4" /> {error}
        </div>
      )}

      {/* Treemap */}
      <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-3 backdrop-blur-xl">
        <p className={cn(lbl, "px-1 pb-2")}>
          Mapa de ventas por {etiquetaGrupo.toLowerCase()} · el tamaño es el importe · clic para ver el detalle
        </p>
        {cargando ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-8 w-8 text-amber-400 animate-spin" />
          </div>
        ) : grupos.length === 0 ? (
          <div className="flex items-center justify-center py-24 text-slate-500 text-[11px] font-black uppercase tracking-widest">
            Sin ventas en el rango seleccionado
          </div>
        ) : (
          <Treemap datos={datosTreemap} onClickItem={abrirGrupo} />
        )}
      </div>

      {/* Tabla de detalle */}
      {grupos.length > 0 && !cargando && (
        <div className="bg-white/[0.04] border border-white/10 rounded-2xl backdrop-blur-xl overflow-hidden">
          <div className="overflow-auto max-h-[420px]">
            <table className="w-full">
              <thead className="sticky top-0 z-10 bg-[#10151f]">
                <tr>
                  <th className={cn(lbl, "px-4 py-2.5 text-left")}>{etiquetaGrupo}</th>
                  <th className={cn(lbl, "px-4 py-2.5 text-right")}>Importe</th>
                  <th className={cn(lbl, "px-4 py-2.5 text-right")}>%</th>
                  <th className={cn(lbl, "px-4 py-2.5 text-right")}>Piezas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {grupos.map((g) => {
                  const pct = totalImporte > 0 ? (g.importe / totalImporte) * 100 : 0;
                  return (
                    <tr
                      key={g.id}
                      onClick={() => abrirGrupo(g.nombre)}
                      className="cursor-pointer hover:bg-white/[0.03] transition-colors"
                    >
                      <td className="px-4 py-2.5 text-[12px] font-bold text-slate-300">{g.nombre}</td>
                      <td className="px-4 py-2.5 text-[12px] font-black text-amber-300 text-right">
                        {moneda(g.importe)}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400 text-right">
                        {pct.toFixed(1)}%
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-bold text-slate-300 text-right">
                        {entero(g.piezas)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal de detalle del grupo: treemap de sus productos + tabla */}
      {grupoAbierto && (
        <div
          className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={cerrarGrupo}
        >
          <div
            className="w-full max-w-4xl max-h-[88vh] bg-[#0d1320] border border-white/10 rounded-2xl overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Cabecera */}
            <div className="flex items-start justify-between gap-3 p-5 border-b border-white/[0.06]">
              <div>
                <h2 className="text-lg font-black text-amber-300">{grupoAbierto.nombre}</h2>
                <p className="text-[11px] font-bold text-slate-400 mt-1">
                  {fechaInicio} al {fechaFin} ·{" "}
                  {sucursal === "usadas" ? "Bodega Usado" : "Matriz"} ·{" "}
                  {moneda(grupoAbierto.importe)} · {entero(grupoAbierto.piezas)} piezas
                </p>
              </div>
              <button
                onClick={cerrarGrupo}
                className="p-2 rounded-xl text-slate-500 hover:text-white hover:bg-white/[0.06] transition-colors shrink-0"
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-auto p-5 space-y-4">
              {cargandoDetalle ? (
                <div className="flex items-center justify-center py-24">
                  <Loader2 className="h-8 w-8 text-amber-400 animate-spin" />
                </div>
              ) : detalle.length === 0 ? (
                <div className="flex items-center justify-center py-24 text-slate-500 text-[11px] font-black uppercase tracking-widest">
                  Sin productos con venta en el rango
                </div>
              ) : (
                <>
                  {/* Treemap de productos del grupo */}
                  <div>
                    <p className={cn(lbl, "pb-2")}>
                      Productos de {grupoAbierto.nombre} · el tamaño es el importe
                    </p>
                    <Treemap datos={datosTreemapDetalle} alto={340} />
                  </div>

                  {/* Tabla de productos */}
                  <div className="border border-white/10 rounded-xl overflow-hidden">
                    <div className="overflow-auto max-h-[300px]">
                      <table className="w-full">
                        <thead className="sticky top-0 bg-[#141a28]">
                          <tr>
                            <th className={cn(lbl, "px-4 py-2.5 text-left")}>Código</th>
                            <th className={cn(lbl, "px-4 py-2.5 text-left")}>Descripción</th>
                            <th className={cn(lbl, "px-4 py-2.5 text-right")}>Importe</th>
                            <th className={cn(lbl, "px-4 py-2.5 text-right")}>%</th>
                            <th className={cn(lbl, "px-4 py-2.5 text-right")}>Piezas</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/[0.04]">
                          {detalle.map((p) => {
                            const pct =
                              totalGrupoAbierto > 0 ? (p.importe / totalGrupoAbierto) * 100 : 0;
                            return (
                              <tr key={p.nombre} className="hover:bg-white/[0.03] transition-colors">
                                <td className="px-4 py-2 text-[12px] font-black text-amber-300">
                                  {p.nombre}
                                </td>
                                <td className="px-4 py-2 text-[12px] font-bold text-slate-300 max-w-[320px] truncate">
                                  {p.descripcion}
                                </td>
                                <td className="px-4 py-2 text-[12px] font-black text-slate-200 text-right">
                                  {moneda(p.importe)}
                                </td>
                                <td className="px-4 py-2 text-[12px] font-bold text-slate-400 text-right">
                                  {pct.toFixed(1)}%
                                </td>
                                <td className="px-4 py-2 text-[12px] font-bold text-slate-300 text-right">
                                  {entero(p.piezas)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
