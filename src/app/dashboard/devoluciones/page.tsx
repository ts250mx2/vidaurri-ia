"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  FileText,
  ListRestart,
  Loader2,
  RefreshCw,
  Search,
  Undo2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { moneda, entero, fechaCorta } from "@/lib/formato";

// ---------- Tipos ----------
interface Devolucion {
  id: number;
  numDevolucion: number;
  fecha: string;
  subtotal: number;
  iva: number;
  total: number;
  estatus: string | null;
}

interface Resumen {
  devoluciones: number;
  importe: number;
  piezas: number;
}

interface DetalleDevolucion {
  devolucion: {
    id: number;
    numDevolucion: number;
    fecha: string;
    subtotal: number;
    iva: number;
    total: number;
    estatus: string | null;
  };
  partidas: {
    partida: number;
    cantidad: number;
    codigo: string;
    descripcion: string;
    precio: number;
    totalPartida: number;
    causaDevolucion: string | null;
  }[];
}

// ---------- Constantes de estilo (patrón kyk-server-web) ----------
const lbl = "text-[10px] font-black text-slate-500 uppercase tracking-widest";
const inputCls =
  "block w-full px-4 py-2.5 bg-white/[0.03] border border-white/10 rounded-xl text-sm font-bold text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-400/25 focus:border-amber-400/60 transition-all";

const PAGE_SIZE = 50;
const DIAS_RANGO_DEFAULT = 30;

const hoyISO = () => new Date().toLocaleDateString("sv-SE");
const diasAtras = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString("sv-SE");
};

// Estatus de devolución: en la práctica todas son VIGENTE, pero se cubre el mapa completo.
const badgeEstatus = (estatus: string | null): string => {
  switch (estatus) {
    case "VIGENTE":
      return "text-amber-300 bg-amber-500/10 border-amber-500/25";
    case "CANCELADA":
      return "text-rose-300 bg-rose-500/10 border-rose-500/25";
    default:
      return "text-cyan-300 bg-cyan-500/10 border-cyan-500/25";
  }
};

export default function DevolucionesPage() {
  const [fechaInicio, setFechaInicio] = useState(diasAtras(DIAS_RANGO_DEFAULT));
  const [fechaFin, setFechaFin] = useState(hoyISO());
  const [busqueda, setBusqueda] = useState("");
  const [page, setPage] = useState(1);

  const [devoluciones, setDevoluciones] = useState<Devolucion[]>([]);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [exportando, setExportando] = useState<"pdf" | "excel" | null>(null);

  const [detalle, setDetalle] = useState<DetalleDevolucion | null>(null);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);

  // Token de secuencia: descarta respuestas de peticiones obsoletas (evita race conditions).
  const peticionRef = useRef(0);

  const cargar = useCallback(
    async (inicio: string, fin: string, filtro: string, pagina: number) => {
      const idPeticion = ++peticionRef.current;
      setCargando(true);
      setError("");
      try {
        const qs = new URLSearchParams({
          fechaInicio: inicio,
          fechaFin: fin,
          page: String(pagina),
          pageSize: String(PAGE_SIZE),
        });
        if (filtro) qs.set("busqueda", filtro);
        const res = await fetch(`/api/devoluciones?${qs.toString()}`);
        if (idPeticion !== peticionRef.current) return;
        if (res.status === 401) {
          window.location.href = "/login";
          return;
        }
        const json = await res.json();
        if (idPeticion !== peticionRef.current) return;
        if (!res.ok) throw new Error(json.error || "Error al consultar devoluciones");
        setDevoluciones(json.devoluciones);
        setResumen(json.resumen);
        setTotal(json.total);
      } catch (err: unknown) {
        if (idPeticion !== peticionRef.current) return;
        setError(err instanceof Error ? err.message : "Error desconocido");
        setDevoluciones([]);
        setResumen(null);
        setTotal(0);
      } finally {
        if (idPeticion === peticionRef.current) setCargando(false);
      }
    },
    []
  );

  useEffect(() => {
    cargar(diasAtras(DIAS_RANGO_DEFAULT), hoyISO(), "", 1);
  }, [cargar]);

  const actualizar = () => {
    setPage(1);
    cargar(fechaInicio, fechaFin, busqueda, 1);
  };

  const preset = (dias: number) => {
    const inicio = diasAtras(dias);
    const fin = hoyISO();
    setFechaInicio(inicio);
    setFechaFin(fin);
    setPage(1);
    cargar(inicio, fin, busqueda, 1);
  };

  const limpiar = () => {
    const inicio = diasAtras(DIAS_RANGO_DEFAULT);
    const fin = hoyISO();
    setFechaInicio(inicio);
    setFechaFin(fin);
    setBusqueda("");
    setPage(1);
    cargar(inicio, fin, "", 1);
  };

  const cambiarPagina = (pagina: number) => {
    setPage(pagina);
    cargar(fechaInicio, fechaFin, busqueda, pagina);
  };

  const verDetalle = async (devolucion: Devolucion) => {
    setCargandoDetalle(true);
    try {
      const res = await fetch(`/api/devoluciones/${devolucion.id}`);
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error al consultar el detalle");
      setDetalle(json);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setCargandoDetalle(false);
    }
  };

  const exportar = async (formato: "pdf" | "excel") => {
    setExportando(formato);
    setError("");
    try {
      // Trae el rango completo (hasta el tope del servidor) para exportar todo.
      const qs = new URLSearchParams({
        fechaInicio,
        fechaFin,
        page: "1",
        pageSize: "20000",
      });
      if (busqueda) qs.set("busqueda", busqueda);
      const res = await fetch(`/api/devoluciones?${qs.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error al exportar");
      const filas: Devolucion[] = json.devoluciones;

      const columnas = [
        { header: "Folio" },
        { header: "Fecha" },
        { header: "Subtotal", align: "right" as const },
        { header: "IVA", align: "right" as const },
        { header: "Total", align: "right" as const },
        { header: "Estatus" },
      ];
      const base = {
        titulo: "REPORTE DE DEVOLUCIONES",
        subtitulo: `Del ${fechaInicio} al ${fechaFin}  ·  ${entero(filas.length)} devoluciones`,
        columnas,
        nombreArchivo: `devoluciones_${fechaInicio}_${fechaFin}`,
      };

      if (formato === "pdf") {
        const { exportarPdf } = await import("@/lib/export");
        await exportarPdf({
          ...base,
          filas: filas.map((d) => [
            d.numDevolucion,
            fechaCorta(d.fecha),
            moneda(d.subtotal),
            moneda(d.iva),
            moneda(d.total),
            d.estatus ?? "",
          ]),
        });
      } else {
        const { exportarExcel } = await import("@/lib/export");
        await exportarExcel({
          ...base,
          hoja: "Devoluciones",
          columnasMoneda: [2, 3, 4],
          filas: filas.map((d) => [
            d.numDevolucion,
            fechaCorta(d.fecha),
            d.subtotal,
            d.iva,
            d.total,
            d.estatus ?? "",
          ]),
        });
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error al exportar");
    } finally {
      setExportando(null);
    }
  };

  const totalPaginas = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const tarjetas = resumen
    ? [
        { titulo: "Devoluciones", valor: entero(resumen.devoluciones), color: "text-slate-200" },
        { titulo: "Importe devuelto", valor: moneda(resumen.importe), color: "text-amber-300" },
        { titulo: "Piezas devueltas", valor: entero(resumen.piezas), color: "text-cyan-300" },
      ]
    : [];

  return (
    <div className="space-y-4">
      {/* Encabezado */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight">Devoluciones</h1>
          <p className={cn(lbl, "mt-1")}>
            {cargando ? "Consultando..." : `${entero(total)} devoluciones en el rango`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => exportar("pdf")}
            disabled={!!exportando || cargando || devoluciones.length === 0}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/[0.05] border border-white/10 text-slate-300 text-[11px] font-black uppercase tracking-widest hover:text-rose-300 transition-all disabled:opacity-40"
          >
            {exportando === "pdf" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FileText className="h-3.5 w-3.5" />
            )}
            PDF
          </button>
          <button
            onClick={() => exportar("excel")}
            disabled={!!exportando || cargando || devoluciones.length === 0}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/[0.05] border border-white/10 text-slate-300 text-[11px] font-black uppercase tracking-widest hover:text-emerald-300 transition-all disabled:opacity-40"
          >
            {exportando === "excel" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FileSpreadsheet className="h-3.5 w-3.5" />
            )}
            Excel
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
            <RefreshCw className={cn("h-3.5 w-3.5", cargando && "animate-spin")} /> Actualizar
          </button>
          <div className="flex items-center gap-1.5">
            {[
              { etiqueta: "30 días", dias: 30 },
              { etiqueta: "90 días", dias: 90 },
              { etiqueta: "180 días", dias: 180 },
            ].map((p) => (
              <button
                key={p.etiqueta}
                onClick={() => preset(p.dias)}
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
              placeholder="Buscar por folio de devolución..."
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

      {/* Tarjetas de resumen */}
      {resumen && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {tarjetas.map((t) => (
            <div
              key={t.titulo}
              className="bg-white/[0.04] border border-white/10 rounded-2xl p-4 backdrop-blur-xl"
            >
              <p className={lbl}>{t.titulo}</p>
              <p className={cn("text-xl font-black mt-2 truncate", t.color)}>{t.valor}</p>
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

      {/* Tabla */}
      <div className="bg-white/[0.04] border border-white/10 rounded-2xl backdrop-blur-xl overflow-hidden">
        {cargando ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-8 w-8 text-amber-400 animate-spin" />
          </div>
        ) : devoluciones.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3 text-slate-500">
            <Undo2 className="h-10 w-10" />
            <p className="text-[11px] font-black uppercase tracking-widest">
              Sin devoluciones en el rango seleccionado
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-auto max-h-[calc(100vh-26rem)]">
              <table className="w-full">
                <thead className="sticky top-0 z-10 bg-[#10151f] shadow-[0_1px_0_rgba(255,255,255,0.08)]">
                  <tr>
                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Folio</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Fecha</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Subtotal</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>IVA</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Total</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-center")}>Estatus</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {devoluciones.map((d) => (
                    <tr
                      key={d.id}
                      onClick={() => verDetalle(d)}
                      className="cursor-pointer transition-colors hover:bg-white/[0.03]"
                    >
                      <td className="px-4 py-2.5 text-[12px] font-black text-cyan-300">
                        {d.numDevolucion}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400">
                        {fechaCorta(d.fecha)}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400 text-right">
                        {moneda(d.subtotal)}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400 text-right">
                        {moneda(d.iva)}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-black text-slate-200 text-right">
                        {moneda(d.total)}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <span
                          className={cn(
                            "text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-lg border",
                            badgeEstatus(d.estatus)
                          )}
                        >
                          {d.estatus ?? "—"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Paginación */}
            {total > PAGE_SIZE && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-white/[0.06]">
                <button
                  onClick={() => cambiarPagina(page - 1)}
                  disabled={page <= 1 || cargando}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/[0.05] border border-white/10 text-slate-300 text-[11px] font-black uppercase tracking-widest disabled:opacity-40 hover:text-amber-300 transition-all"
                >
                  <ChevronLeft className="h-3.5 w-3.5" /> Anterior
                </button>
                <span className={lbl}>
                  Página {entero(page)} de {entero(totalPaginas)}
                </span>
                <button
                  onClick={() => cambiarPagina(page + 1)}
                  disabled={page >= totalPaginas || cargando}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/[0.05] border border-white/10 text-slate-300 text-[11px] font-black uppercase tracking-widest disabled:opacity-40 hover:text-amber-300 transition-all"
                >
                  Siguiente <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Overlay de carga del detalle */}
      {cargandoDetalle && (
        <div className="fixed inset-0 z-[80] bg-black/50 backdrop-blur-sm flex items-center justify-center">
          <Loader2 className="h-8 w-8 text-amber-400 animate-spin" />
        </div>
      )}

      {/* Modal de detalle */}
      {detalle && (
        <div
          className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setDetalle(null)}
        >
          <div
            className="w-full max-w-3xl max-h-[85vh] bg-[#0d1320] border border-white/10 rounded-2xl overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Cabecera del modal */}
            <div className="flex items-start justify-between gap-3 p-5 border-b border-white/[0.06]">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-lg font-black text-white">
                    Devolución {detalle.devolucion.numDevolucion}
                  </h2>
                  <span
                    className={cn(
                      "text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-lg border",
                      badgeEstatus(detalle.devolucion.estatus)
                    )}
                  >
                    {detalle.devolucion.estatus ?? "—"}
                  </span>
                </div>
                <p className="text-[11px] font-bold text-slate-400 mt-1.5">
                  {fechaCorta(detalle.devolucion.fecha)} · Nota de salida
                </p>
              </div>
              <button
                onClick={() => setDetalle(null)}
                className="p-2 rounded-xl text-slate-500 hover:text-white hover:bg-white/[0.06] transition-colors"
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Partidas */}
            <div className="flex-1 overflow-auto">
              <table className="w-full">
                <thead className="sticky top-0 bg-[#141a28]">
                  <tr>
                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>#</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Código</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Descripción</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Cant</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Precio</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Importe</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {detalle.partidas.map((p) => (
                    <tr key={p.partida}>
                      <td className="px-4 py-2 text-[12px] font-bold text-slate-500">{p.partida}</td>
                      <td className="px-4 py-2 text-[12px] font-black text-amber-300">{p.codigo}</td>
                      <td className="px-4 py-2 text-[12px] font-bold text-slate-300">
                        {p.descripcion}
                        {p.causaDevolucion?.trim() ? (
                          <p className="text-[10px] font-bold text-rose-300/80 mt-0.5">
                            Causa: {p.causaDevolucion}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-4 py-2 text-[12px] font-black text-slate-200 text-right">
                        {entero(p.cantidad)}
                      </td>
                      <td className="px-4 py-2 text-[12px] font-bold text-slate-400 text-right">
                        {moneda(p.precio)}
                      </td>
                      <td className="px-4 py-2 text-[12px] font-black text-slate-200 text-right">
                        {moneda(p.totalPartida)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pie: totales */}
            <div className="p-5 border-t border-white/[0.06] flex flex-wrap items-end justify-between gap-4">
              <p className="text-[11px] font-bold text-slate-500">
                {entero(detalle.partidas.length)} partida(s) devuelta(s)
              </p>
              <div className="text-right space-y-0.5">
                <p className="text-[11px] font-bold text-slate-400">
                  Subtotal{" "}
                  <span className="text-slate-200 ml-2">{moneda(detalle.devolucion.subtotal)}</span>
                </p>
                <p className="text-[11px] font-bold text-slate-400">
                  IVA <span className="text-slate-200 ml-2">{moneda(detalle.devolucion.iva)}</span>
                </p>
                <p className="text-base font-black text-amber-300">
                  Total <span className="ml-2">{moneda(detalle.devolucion.total)}</span>
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
