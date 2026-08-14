"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  FileText,
  ImageOff,
  ListRestart,
  Loader2,
  Package,
  PackageCheck,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { moneda, entero } from "@/lib/formato";

// ---------- Tipos ----------
interface Pieza {
  idPieza: number;
  codigo: string;
  descripcion: string;
  parte: string;
  marca: string;
  modelo: string;
  anioInicio: number | null;
  anioFin: number | null;
  lado: string | null;
  precio: number;
  precioConIva: number;
  existencia: number;
  ubicacion: string | null;
  fotoNombre: string | null;
}

interface Resumen {
  piezas: number;
  unidades: number;
  valor: number;
}

interface DetallePieza {
  pieza: Pieza & {
    posicion: string | null;
    puertas: number | null;
    origen: string | null;
    numeroParte: string | null;
    comentarios: string | null;
  };
  /** nombre_imagen de cada foto activa de la pieza. */
  fotos: string[];
}

interface Opcion {
  id: number;
  parte?: string;
  marca?: string;
}

// ---------- Constantes de estilo (patrón del catálogo de Artículos) ----------
const lbl = "text-[10px] font-black text-slate-500 uppercase tracking-widest";
const inputCls =
  "block w-full px-4 py-2.5 bg-white/[0.03] border border-white/10 rounded-xl text-sm font-bold text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-400/25 focus:border-emerald-400/60 transition-all";

const PAGE_SIZE = 50;

function urlFoto(nombreImagen: string): string {
  return `/api/usadas/foto?n=${encodeURIComponent(nombreImagen)}`;
}

/** Miniatura de la pieza con marcador cuando no hay foto. */
function FotoPieza({ pieza, grande = false }: { pieza: Pieza; grande?: boolean }) {
  const [falla, setFalla] = useState(false);
  useEffect(() => {
    setFalla(false);
  }, [pieza.idPieza]);

  const clase = grande
    ? "h-24 w-24 shrink-0 rounded-xl border border-white/10 object-contain bg-white"
    : "h-10 w-10 rounded-lg mx-auto object-contain bg-white";
  if (pieza.fotoNombre == null || falla) {
    return (
      <div
        className={cn(
          "flex items-center justify-center bg-white/[0.03] border border-white/10 text-slate-600",
          grande ? "h-24 w-24 shrink-0 rounded-xl" : "h-10 w-10 rounded-lg mx-auto"
        )}
        title="Sin foto"
      >
        <ImageOff className={grande ? "h-8 w-8" : "h-4 w-4"} />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={urlFoto(pieza.fotoNombre)}
      alt={`Foto ${pieza.codigo}`}
      loading="lazy"
      onError={() => setFalla(true)}
      className={clase}
    />
  );
}

export default function PiezasUsadasPage() {
  const [busqueda, setBusqueda] = useState("");
  const [idParte, setIdParte] = useState("");
  const [idMarca, setIdMarca] = useState("");
  // El inventario útil de la bodega es lo que tiene existencia: encendido por defecto.
  const [soloExistencia, setSoloExistencia] = useState(true);
  const [page, setPage] = useState(1);

  const [partes, setPartes] = useState<Opcion[]>([]);
  const [marcas, setMarcas] = useState<Opcion[]>([]);

  const [piezas, setPiezas] = useState<Pieza[]>([]);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [exportando, setExportando] = useState<"pdf" | "excel" | null>(null);

  const [detalle, setDetalle] = useState<DetallePieza | null>(null);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);
  const [fotoActiva, setFotoActiva] = useState(0);

  // Token de secuencia: descarta respuestas viejas tras una petición más nueva.
  const peticionRef = useRef(0);

  const cargar = useCallback(
    async (filtro: string, parte: string, marca: string, existencia: boolean, pagina: number) => {
      const idPeticion = ++peticionRef.current;
      setCargando(true);
      setError("");
      try {
        const qs = new URLSearchParams({ page: String(pagina), pageSize: String(PAGE_SIZE) });
        if (filtro) qs.set("busqueda", filtro);
        if (parte) qs.set("idParte", parte);
        if (marca) qs.set("idMarca", marca);
        if (existencia) qs.set("conExistencia", "1");
        const res = await fetch(`/api/usadas/piezas?${qs.toString()}`);
        if (idPeticion !== peticionRef.current) return;
        if (res.status === 401) {
          window.location.href = "/login";
          return;
        }
        const json = await res.json();
        if (idPeticion !== peticionRef.current) return;
        if (!res.ok) throw new Error(json.error || "Error al consultar la Bodega Usado");
        setPiezas(json.piezas);
        setResumen(json.resumen);
        setTotal(json.total);
      } catch (err: unknown) {
        if (idPeticion !== peticionRef.current) return;
        setError(err instanceof Error ? err.message : "Error desconocido");
        setPiezas([]);
        setResumen(null);
        setTotal(0);
      } finally {
        if (idPeticion === peticionRef.current) setCargando(false);
      }
    },
    []
  );

  useEffect(() => {
    const cargarCatalogos = async () => {
      try {
        const res = await fetch("/api/usadas/catalogos");
        if (res.status === 401) {
          window.location.href = "/login";
          return;
        }
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Error al consultar catálogos");
        setPartes(json.partes);
        setMarcas(json.marcas);
      } catch {
        // Los selects quedan vacíos sin bloquear el listado.
        setPartes([]);
        setMarcas([]);
      }
    };
    cargarCatalogos();
    cargar("", "", "", true, 1);
  }, [cargar]);

  const actualizar = () => {
    setPage(1);
    cargar(busqueda, idParte, idMarca, soloExistencia, 1);
  };

  const alternarExistencia = () => {
    const valor = !soloExistencia;
    setSoloExistencia(valor);
    setPage(1);
    cargar(busqueda, idParte, idMarca, valor, 1);
  };

  const limpiar = () => {
    setBusqueda("");
    setIdParte("");
    setIdMarca("");
    setSoloExistencia(true);
    setPage(1);
    cargar("", "", "", true, 1);
  };

  const cambiarPagina = (pagina: number) => {
    setPage(pagina);
    cargar(busqueda, idParte, idMarca, soloExistencia, pagina);
  };

  const verDetalle = async (pieza: Pieza) => {
    setCargandoDetalle(true);
    setFotoActiva(0);
    try {
      const res = await fetch(`/api/usadas/piezas/${pieza.idPieza}`);
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
      const qs = new URLSearchParams({ page: "1", pageSize: "20000" });
      if (busqueda) qs.set("busqueda", busqueda);
      if (idParte) qs.set("idParte", idParte);
      if (idMarca) qs.set("idMarca", idMarca);
      if (soloExistencia) qs.set("conExistencia", "1");
      const res = await fetch(`/api/usadas/piezas?${qs.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error al exportar");
      const filas: Pieza[] = json.piezas;

      const columnas = [
        { header: "Código" },
        { header: "Descripción" },
        { header: "Parte" },
        { header: "Marca" },
        { header: "Modelo" },
        { header: "Años" },
        { header: "Precio", align: "right" as const },
        { header: "Con IVA", align: "right" as const },
        { header: "Exist.", align: "right" as const },
        { header: "Ubicación" },
      ];
      const hoy = new Date().toLocaleDateString("sv-SE");
      const base = {
        titulo: "PIEZAS USADAS — BODEGA USADO",
        subtitulo: `${soloExistencia ? "Solo con existencia  ·  " : ""}${
          busqueda ? `Búsqueda "${busqueda}"  ·  ` : ""
        }${entero(filas.length)} piezas`,
        columnas,
        nombreArchivo: `piezas_usadas_${hoy}`,
      };
      const rango = (p: Pieza) =>
        p.anioInicio || p.anioFin ? `${p.anioInicio ?? "?"}-${p.anioFin ?? "?"}` : "";

      if (formato === "pdf") {
        const { exportarPdf } = await import("@/lib/export");
        await exportarPdf({
          ...base,
          orientacion: "landscape",
          filas: filas.map((p) => [
            p.codigo,
            p.descripcion,
            p.parte,
            p.marca,
            p.modelo,
            rango(p),
            moneda(p.precio),
            moneda(p.precioConIva),
            entero(p.existencia),
            p.ubicacion ?? "",
          ]),
        });
      } else {
        const { exportarExcel } = await import("@/lib/export");
        await exportarExcel({
          ...base,
          hoja: "Piezas Usadas",
          columnasMoneda: [6, 7],
          filas: filas.map((p) => [
            p.codigo,
            p.descripcion,
            p.parte,
            p.marca,
            p.modelo,
            rango(p),
            p.precio,
            p.precioConIva,
            p.existencia,
            p.ubicacion ?? "",
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
  const rangoAnios = (p: { anioInicio: number | null; anioFin: number | null }) =>
    p.anioInicio || p.anioFin ? `${p.anioInicio ?? "?"}-${p.anioFin ?? "?"}` : "—";

  const tarjetas = resumen
    ? [
        { titulo: "Piezas", valor: entero(resumen.piezas), color: "text-slate-200" },
        { titulo: "Unidades", valor: entero(resumen.unidades), color: "text-cyan-300" },
        { titulo: "Valor del inventario", valor: moneda(resumen.valor), color: "text-emerald-300" },
      ]
    : [];

  return (
    <div className="space-y-4">
      {/* Encabezado */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight">Piezas Usadas</h1>
          <p className={cn(lbl, "mt-1")}>
            {cargando
              ? "Consultando..."
              : `Bodega Usado · ${entero(total)} piezas en el catálogo`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => exportar("pdf")}
            disabled={!!exportando || cargando || piezas.length === 0}
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
            disabled={!!exportando || cargando || piezas.length === 0}
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
          <div className="relative flex-1 min-w-[260px] space-y-1.5">
            <label className={lbl}>Buscar</label>
            <div className="relative">
              <Search className="absolute top-1/2 -translate-y-1/2 left-3.5 h-4 w-4 text-slate-500" />
              <input
                type="text"
                className={cn(inputCls, "pl-10")}
                placeholder="Ej: puerta silverado, calavera sentra..."
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && actualizar()}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className={lbl}>Parte</label>
            <select
              className={cn(inputCls, "w-48 appearance-none [color-scheme:dark]")}
              value={idParte}
              onChange={(e) => setIdParte(e.target.value)}
            >
              <option value="" className="bg-[#0d1320]">Todas</option>
              {partes.map((p) => (
                <option key={p.id} value={p.id} className="bg-[#0d1320]">
                  {p.parte}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className={lbl}>Marca</label>
            <select
              className={cn(inputCls, "w-48 appearance-none [color-scheme:dark]")}
              value={idMarca}
              onChange={(e) => setIdMarca(e.target.value)}
            >
              <option value="" className="bg-[#0d1320]">Todas</option>
              {marcas.map((m) => (
                <option key={m.id} value={m.id} className="bg-[#0d1320]">
                  {m.marca}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={alternarExistencia}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 rounded-xl border text-[11px] font-black uppercase tracking-widest transition-all",
              soloExistencia
                ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
                : "bg-white/[0.05] border-white/10 text-slate-400 hover:text-emerald-300"
            )}
          >
            <PackageCheck className="h-3.5 w-3.5" /> Solo con existencia
          </button>
          <button
            onClick={actualizar}
            disabled={cargando}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500 text-slate-950 text-[11px] font-black uppercase tracking-widest hover:brightness-110 transition-all disabled:opacity-40"
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
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
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
            <Loader2 className="h-8 w-8 text-emerald-400 animate-spin" />
          </div>
        ) : piezas.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3 text-slate-500">
            <Package className="h-10 w-10" />
            <p className="text-[11px] font-black uppercase tracking-widest">
              Sin piezas con los filtros seleccionados
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-auto max-h-[calc(100vh-24rem)]">
              <table className="w-full">
                <thead className="sticky top-0 z-10 bg-[#10151f] shadow-[0_1px_0_rgba(255,255,255,0.08)]">
                  <tr>
                    <th className={cn(lbl, "px-4 py-2.5 text-center")}>Foto</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Código</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Descripción</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Parte</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Marca / Modelo</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-center")}>Años</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Precio</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Con IVA</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Exist.</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Ubicación</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {piezas.map((p) => (
                    <tr
                      key={p.idPieza}
                      onClick={() => verDetalle(p)}
                      className="cursor-pointer transition-colors hover:bg-white/[0.03]"
                    >
                      <td className="px-4 py-2 text-center">
                        <FotoPieza pieza={p} />
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-black text-emerald-300">
                        {p.codigo}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-bold text-slate-300 max-w-[260px] truncate">
                        {p.descripcion}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400">
                        {p.parte || "—"}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400 max-w-[160px] truncate">
                        {[p.marca, p.modelo].filter(Boolean).join(" ") || "—"}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400 text-center">
                        {rangoAnios(p)}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400 text-right">
                        {p.precio > 0 ? moneda(p.precio) : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-black text-emerald-300 text-right">
                        {p.precio > 0 ? moneda(p.precioConIva) : "—"}
                      </td>
                      <td
                        className={cn(
                          "px-4 py-2.5 text-[12px] font-black text-right",
                          p.existencia > 0 ? "text-emerald-300" : "text-slate-500"
                        )}
                      >
                        {entero(p.existencia)}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400">
                        {p.ubicacion || "—"}
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
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/[0.05] border border-white/10 text-slate-300 text-[11px] font-black uppercase tracking-widest disabled:opacity-40 hover:text-emerald-300 transition-all"
                >
                  <ChevronLeft className="h-3.5 w-3.5" /> Anterior
                </button>
                <span className={lbl}>
                  Página {entero(page)} de {entero(totalPaginas)}
                </span>
                <button
                  onClick={() => cambiarPagina(page + 1)}
                  disabled={page >= totalPaginas || cargando}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/[0.05] border border-white/10 text-slate-300 text-[11px] font-black uppercase tracking-widest disabled:opacity-40 hover:text-emerald-300 transition-all"
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
          <Loader2 className="h-8 w-8 text-emerald-400 animate-spin" />
        </div>
      )}

      {/* Modal de detalle con galería de fotos */}
      {detalle && (
        <div
          className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setDetalle(null)}
        >
          <div
            className="w-full max-w-3xl max-h-[85vh] bg-[#0d1320] border border-white/10 rounded-2xl overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Cabecera */}
            <div className="flex items-start justify-between gap-3 p-5 border-b border-white/[0.06]">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-lg font-black text-emerald-300">{detalle.pieza.codigo}</h2>
                  <span
                    className={cn(
                      "text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-lg border",
                      detalle.pieza.existencia > 0
                        ? "text-emerald-300 bg-emerald-500/10 border-emerald-500/25"
                        : "text-rose-300 bg-rose-500/10 border-rose-500/25"
                    )}
                  >
                    {detalle.pieza.existencia > 0
                      ? `Existencia ${entero(detalle.pieza.existencia)}`
                      : "Sin existencia"}
                  </span>
                  <span className="text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-lg border text-cyan-300 bg-cyan-500/10 border-cyan-500/25">
                    Pieza usada
                  </span>
                </div>
                <p className="text-[11px] font-bold text-slate-300 mt-1.5">
                  {detalle.pieza.descripcion}
                </p>
                <p className="text-[11px] font-bold text-slate-500 mt-1">
                  {[detalle.pieza.marca, detalle.pieza.modelo].filter(Boolean).join(" ")}
                  {detalle.pieza.anioInicio || detalle.pieza.anioFin
                    ? ` · ${rangoAnios(detalle.pieza)}`
                    : ""}
                </p>
              </div>
              <button
                onClick={() => setDetalle(null)}
                className="p-2 rounded-xl text-slate-500 hover:text-white hover:bg-white/[0.06] transition-colors shrink-0"
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-auto p-5 space-y-5">
              {/* Galería de fotos */}
              {detalle.fotos.length > 0 ? (
                <div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={urlFoto(detalle.fotos[fotoActiva] ?? detalle.fotos[0])}
                    alt={`Foto ${detalle.pieza.codigo}`}
                    className="w-full max-h-72 object-contain rounded-xl border border-white/10 bg-white"
                  />
                  {detalle.fotos.length > 1 && (
                    <div className="flex gap-2 mt-2 overflow-x-auto pb-1">
                      {detalle.fotos.map((nombre, i) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={nombre}
                          src={urlFoto(nombre)}
                          alt={`Miniatura ${i + 1}`}
                          onClick={() => setFotoActiva(i)}
                          className={cn(
                            "h-14 w-14 object-contain rounded-lg border cursor-pointer bg-white",
                            i === fotoActiva
                              ? "border-emerald-400"
                              : "border-white/10 opacity-70 hover:opacity-100"
                          )}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-[11px] font-bold text-slate-500">Sin fotos registradas</p>
              )}

              {/* Ficha */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  {
                    titulo: "Precio",
                    valor: detalle.pieza.precio > 0 ? moneda(detalle.pieza.precio) : "—",
                    color: "text-slate-200",
                  },
                  {
                    titulo: "Con IVA",
                    valor: detalle.pieza.precio > 0 ? moneda(detalle.pieza.precioConIva) : "—",
                    color: "text-emerald-300",
                  },
                  { titulo: "Parte", valor: detalle.pieza.parte || "—", color: "text-slate-200" },
                  { titulo: "Lado", valor: detalle.pieza.lado || "—", color: "text-slate-200" },
                  {
                    titulo: "Posición",
                    valor: detalle.pieza.posicion || "—",
                    color: "text-slate-200",
                  },
                  { titulo: "Origen", valor: detalle.pieza.origen || "—", color: "text-slate-200" },
                  {
                    titulo: "No. de parte",
                    valor: detalle.pieza.numeroParte || "—",
                    color: "text-cyan-300",
                  },
                  {
                    titulo: "Ubicación",
                    valor: detalle.pieza.ubicacion || "—",
                    color: "text-cyan-300",
                  },
                ].map((c) => (
                  <div key={c.titulo} className="bg-white/[0.03] border border-white/10 rounded-xl p-3">
                    <p className={lbl}>{c.titulo}</p>
                    <p className={cn("text-sm font-black mt-1 truncate", c.color)}>{c.valor}</p>
                  </div>
                ))}
              </div>

              {detalle.pieza.comentarios && (
                <p className="text-[11px] font-bold text-slate-400 bg-white/[0.03] border border-white/10 rounded-xl p-3">
                  {detalle.pieza.comentarios}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
