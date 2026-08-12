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
  PackageX,
  RefreshCw,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { moneda, entero } from "@/lib/formato";

// ---------- Tipos ----------
type Vista = "quiebres" | "reorden";

interface Articulo {
  id: number;
  codigo: string;
  descripcion: string | null;
  linea: string | null;
  existencia: number;
  piezas90: number;
  precioLista: number;
  minimo: number | null;
  reorden: number | null;
  maximo: number | null;
  localizacion: string | null;
}

interface Resumen {
  codigos: number;
  piezas90: number;
  valorRecompra: number;
}

// ---------- Constantes de estilo (patrón kyk-server-web) ----------
const lbl = "text-[10px] font-black text-slate-500 uppercase tracking-widest";
const inputCls =
  "block w-full px-4 py-2.5 bg-white/[0.03] border border-white/10 rounded-xl text-sm font-bold text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-400/25 focus:border-amber-400/60 transition-all";

const PAGE_SIZE = 50;

const TABS_VISTA: { clave: Vista; etiqueta: string }[] = [
  { clave: "quiebres", etiqueta: "Quiebres" },
  { clave: "reorden", etiqueta: "Bajo reorden" },
];

export default function QuiebresPage() {
  const [vista, setVista] = useState<Vista>("quiebres");
  const [busqueda, setBusqueda] = useState("");
  const [page, setPage] = useState(1);

  const [articulos, setArticulos] = useState<Articulo[]>([]);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [exportando, setExportando] = useState<"pdf" | "excel" | null>(null);

  // Token de secuencia: descarta respuestas viejas que lleguen tarde y pisen datos nuevos.
  const peticionRef = useRef(0);

  const cargar = useCallback(async (v: Vista, filtro: string, pagina: number) => {
    const idPeticion = ++peticionRef.current;
    setCargando(true);
    setError("");
    try {
      const qs = new URLSearchParams({
        tipo: v,
        page: String(pagina),
        pageSize: String(PAGE_SIZE),
      });
      if (filtro) qs.set("busqueda", filtro);
      const res = await fetch(`/api/inventario/quiebres?${qs.toString()}`);
      // Si otra petición más nueva empezó, descarta esta silenciosamente.
      if (idPeticion !== peticionRef.current) return;
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      const json = await res.json();
      if (idPeticion !== peticionRef.current) return;
      if (!res.ok) throw new Error(json.error || "Error al consultar quiebres");
      setArticulos(json.articulos);
      setResumen(json.resumen);
      setTotal(json.total);
    } catch (err: unknown) {
      // No escribas el error de una petición obsoleta.
      if (idPeticion !== peticionRef.current) return;
      setError(err instanceof Error ? err.message : "Error desconocido");
      setArticulos([]);
      setResumen(null);
      setTotal(0);
    } finally {
      // No apagues el spinner de una petición vigente con una respuesta vieja.
      if (idPeticion === peticionRef.current) setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar("quiebres", "", 1);
  }, [cargar]);

  const actualizar = () => {
    setPage(1);
    cargar(vista, busqueda, 1);
  };

  const cambiarVista = (v: Vista) => {
    setVista(v);
    setPage(1);
    cargar(v, busqueda, 1);
  };

  const limpiar = () => {
    setBusqueda("");
    setPage(1);
    cargar(vista, "", 1);
  };

  const cambiarPagina = (pagina: number) => {
    setPage(pagina);
    cargar(vista, busqueda, pagina);
  };

  const exportar = async (formato: "pdf" | "excel") => {
    setExportando(formato);
    setError("");
    try {
      // Trae la vista completa (hasta el tope del servidor) para exportar todo.
      const qs = new URLSearchParams({ tipo: vista, page: "1", pageSize: "20000" });
      if (busqueda) qs.set("busqueda", busqueda);
      const res = await fetch(`/api/inventario/quiebres?${qs.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error al exportar");
      const filas: Articulo[] = json.articulos;

      const esQuiebre = vista === "quiebres";
      const columnas = [
        { header: "Código" },
        { header: "Descripción" },
        { header: "Línea" },
        { header: "Localización" },
        { header: "Existencia", align: "right" as const },
        { header: "Vend. 90 días", align: "right" as const },
        { header: "Precio lista", align: "right" as const },
        { header: "Mín", align: "right" as const },
        { header: "Reorden", align: "right" as const },
        { header: "Máx", align: "right" as const },
      ];
      const base = {
        titulo: esQuiebre ? "INVENTARIO · QUIEBRES" : "INVENTARIO · BAJO REORDEN",
        subtitulo: `${
          esQuiebre
            ? "Sin existencia y con venta en los últimos 90 días"
            : "Existencia en o por debajo del punto de reorden"
        }${busqueda ? `  ·  "${busqueda}"` : ""}  ·  ${entero(filas.length)} códigos`,
        columnas,
        nombreArchivo: `${esQuiebre ? "quiebres" : "reorden"}_${new Date().toLocaleDateString("sv-SE")}`,
      };

      if (formato === "pdf") {
        const { exportarPdf } = await import("@/lib/export");
        await exportarPdf({
          ...base,
          orientacion: "landscape",
          filas: filas.map((a) => [
            a.codigo,
            a.descripcion ?? "",
            a.linea ?? "",
            a.localizacion ?? "",
            entero(a.existencia),
            entero(a.piezas90),
            moneda(a.precioLista),
            a.minimo == null ? "" : entero(a.minimo),
            a.reorden == null ? "" : entero(a.reorden),
            a.maximo == null ? "" : entero(a.maximo),
          ]),
        });
      } else {
        const { exportarExcel } = await import("@/lib/export");
        await exportarExcel({
          ...base,
          hoja: esQuiebre ? "Quiebres" : "Bajo reorden",
          columnasMoneda: [6],
          filas: filas.map((a) => [
            a.codigo,
            a.descripcion ?? "",
            a.linea ?? "",
            a.localizacion ?? "",
            a.existencia,
            a.piezas90,
            a.precioLista,
            a.minimo,
            a.reorden,
            a.maximo,
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
  const esQuiebre = vista === "quiebres";

  const tarjetas = resumen
    ? [
        { titulo: "Códigos", valor: entero(resumen.codigos), color: "text-slate-200" },
        { titulo: "Vendidas 90 días", valor: entero(resumen.piezas90), color: "text-cyan-300" },
        { titulo: "Recompra estimada", valor: moneda(resumen.valorRecompra), color: "text-amber-300" },
      ]
    : [];

  return (
    <div className="space-y-4">
      {/* Encabezado */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight">Quiebres y reorden</h1>
          <p className={cn(lbl, "mt-1")}>
            {cargando
              ? "Consultando..."
              : `${entero(total)} códigos ${esQuiebre ? "en quiebre" : "bajo reorden"}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => exportar("pdf")}
            disabled={!!exportando || cargando || articulos.length === 0}
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
            disabled={!!exportando || cargando || articulos.length === 0}
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
      <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-4 backdrop-blur-xl">
        <div className="flex flex-wrap items-center gap-3">
          {/* Tabs pill de vista */}
          <div className="flex items-center gap-1.5">
            {TABS_VISTA.map((t) => (
              <button
                key={t.clave}
                onClick={() => cambiarVista(t.clave)}
                className={cn(
                  "px-3 py-2 rounded-lg border text-[10px] font-black uppercase tracking-widest transition-all",
                  vista === t.clave
                    ? "bg-amber-500 border-amber-500 text-slate-950"
                    : "bg-white/[0.05] border-white/10 text-slate-400 hover:text-amber-300"
                )}
              >
                {t.etiqueta}
              </button>
            ))}
          </div>
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute top-1/2 -translate-y-1/2 left-3.5 h-4 w-4 text-slate-500" />
            <input
              type="text"
              className={cn(inputCls, "pl-10")}
              placeholder="Buscar por código o descripción..."
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && actualizar()}
            />
          </div>
          <button
            onClick={actualizar}
            disabled={cargando}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500 text-slate-950 text-[11px] font-black uppercase tracking-widest hover:brightness-110 transition-all disabled:opacity-40"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", cargando && "animate-spin")} /> Actualizar
          </button>
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
        ) : articulos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3 text-slate-500">
            <PackageX className="h-10 w-10" />
            <p className="text-[11px] font-black uppercase tracking-widest">
              {esQuiebre
                ? "Sin quiebres: lo vendido en 90 días tiene existencia"
                : "Sin artículos en o por debajo de su punto de reorden"}
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-auto max-h-[calc(100vh-24rem)]">
              <table className="w-full">
                <thead className="sticky top-0 z-10 bg-[#10151f] shadow-[0_1px_0_rgba(255,255,255,0.08)]">
                  <tr>
                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Código</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Descripción</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Línea</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Localización</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Existencia</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Vend. 90 días</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Precio lista</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Mín</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Reorden</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Máx</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {articulos.map((a) => (
                    <tr key={a.id} className="transition-colors hover:bg-white/[0.03]">
                      <td className="px-4 py-2.5 text-[12px] font-black text-amber-300">
                        {a.codigo}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-bold text-slate-300 max-w-[280px] truncate">
                        {a.descripcion}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400">
                        {a.linea}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-bold text-cyan-300">
                        {a.localizacion ?? "—"}
                      </td>
                      <td
                        className={cn(
                          "px-4 py-2.5 text-[12px] font-black text-right",
                          a.existencia <= 0
                            ? "text-rose-300"
                            : a.reorden != null && a.reorden > 0 && a.existencia <= a.reorden
                              ? "text-amber-300"
                              : "text-slate-200"
                        )}
                      >
                        {entero(a.existencia)}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-black text-cyan-300 text-right">
                        {entero(a.piezas90)}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400 text-right">
                        {moneda(a.precioLista)}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-bold text-slate-500 text-right">
                        {a.minimo == null ? "—" : entero(a.minimo)}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-bold text-slate-500 text-right">
                        {a.reorden == null ? "—" : entero(a.reorden)}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-bold text-slate-500 text-right">
                        {a.maximo == null ? "—" : entero(a.maximo)}
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
    </div>
  );
}
