"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Boxes,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  FileText,
  ListRestart,
  Loader2,
  RefreshCw,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { entero, fechaCorta, moneda } from "@/lib/formato";
import {
  SelectorSucursal,
  SUCURSALES,
  type Sucursal,
} from "@/components/dashboard/SelectorSucursal";

// ---------- Tipos ----------
interface Movimiento {
  id: number;
  fecha: string;
  tipoMov: string;
  numDoc: number | string | null;
  codigo: string;
  descripcion: string;
  existAnt: number;
  cantidad: number;
  existPost: number;
  // Solo matriz (bdav)
  tipoDoc?: string | null;
  usuario?: string | null;
  // Solo Bodega Usado (bitacora_piezas)
  precio?: number;
  total?: number;
}

interface Resumen {
  movimientos: number;
  entradas: number;
  ventas: number;
  devoluciones: number;
  piezas: number;
}

// ---------- Constantes de estilo (patrón kyk-server-web) ----------
const lbl = "text-[10px] font-black text-slate-500 uppercase tracking-widest";
const inputCls =
  "block w-full px-4 py-2.5 bg-white/[0.03] border border-white/10 rounded-xl text-sm font-bold text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-400/25 focus:border-amber-400/60 transition-all";

const PAGE_SIZE = 50;

const TABS_TIPO = [
  { clave: "", etiqueta: "Todos" },
  { clave: "ENTRADA", etiqueta: "Entradas" },
  { clave: "VENTA", etiqueta: "Ventas" },
  { clave: "DEVOLUCION", etiqueta: "Devoluciones" },
];

const hoyISO = () => new Date().toLocaleDateString("sv-SE");
const diasAtras = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString("sv-SE");
};

const badgeTipo = (tipo: string) =>
  tipo === "ENTRADA"
    ? "text-emerald-300 bg-emerald-500/10 border-emerald-500/25"
    : tipo === "VENTA"
      ? "text-cyan-300 bg-cyan-500/10 border-cyan-500/25"
      : "text-rose-300 bg-rose-500/10 border-rose-500/25";

// Badge de la Bodega Usado: patrón claseTipoMov del proyecto
// (VENTA verde, DEVOLUCION rojo, ENTRADA cyan).
const badgeTipoUsadas = (tipo: string) =>
  tipo === "VENTA"
    ? "text-emerald-300 bg-emerald-500/10 border-emerald-500/25"
    : tipo === "DEVOLUCION"
      ? "text-rose-300 bg-rose-500/10 border-rose-500/25"
      : "text-cyan-300 bg-cyan-500/10 border-cyan-500/25";

// Signo visual según el tipo: la venta descuenta existencia, lo demás la suma.
const cantidadVisual = (m: Movimiento) =>
  m.tipoMov === "VENTA" ? `-${entero(Math.abs(m.cantidad))}` : `+${entero(Math.abs(m.cantidad))}`;

const colorCantidad = (tipo: string) =>
  tipo === "ENTRADA" ? "text-emerald-300" : tipo === "VENTA" ? "text-cyan-300" : "text-rose-300";

const colorCantidadUsadas = (tipo: string) =>
  tipo === "VENTA" ? "text-emerald-300" : tipo === "DEVOLUCION" ? "text-rose-300" : "text-cyan-300";

export default function KardexPage() {
  const [sucursal, setSucursal] = useState<Sucursal>("matriz");
  const [fechaInicio, setFechaInicio] = useState(hoyISO());
  const [fechaFin, setFechaFin] = useState(hoyISO());
  const [tipoMov, setTipoMov] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [page, setPage] = useState(1);

  const [movimientos, setMovimientos] = useState<Movimiento[]>([]);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [exportando, setExportando] = useState<"pdf" | "excel" | null>(null);

  // Token de secuencia: descarta respuestas de peticiones obsoletas (evita race condition).
  const peticionRef = useRef(0);

  const cargar = useCallback(
    async (suc: Sucursal, inicio: string, fin: string, tipo: string, filtro: string, pagina: number) => {
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
        if (suc === "usadas") qs.set("sucursal", "usadas");
        if (tipo) qs.set("tipoMov", tipo);
        if (filtro) qs.set("busqueda", filtro);
        const res = await fetch(`/api/inventario/kardex?${qs.toString()}`);
        if (idPeticion !== peticionRef.current) return;
        if (res.status === 401) {
          window.location.href = "/login";
          return;
        }
        const json = await res.json();
        if (idPeticion !== peticionRef.current) return;
        if (!res.ok) throw new Error(json.error || "Error al consultar el kardex");
        setMovimientos(json.movimientos);
        setResumen(json.resumen);
        setTotal(json.total);
      } catch (err: unknown) {
        if (idPeticion !== peticionRef.current) return;
        setError(err instanceof Error ? err.message : "Error desconocido");
        setMovimientos([]);
        setResumen(null);
        setTotal(0);
      } finally {
        if (idPeticion === peticionRef.current) setCargando(false);
      }
    },
    []
  );

  useEffect(() => {
    cargar("matriz", hoyISO(), hoyISO(), "", "", 1);
  }, [cargar]);

  const actualizar = () => {
    setPage(1);
    cargar(sucursal, fechaInicio, fechaFin, tipoMov, busqueda, 1);
  };

  // Los tres tipos de movimiento y el resto de filtros aplican igual en ambas
  // sucursales: al cambiar solo se resetea la página y se recarga.
  const cambiarSucursal = (nueva: Sucursal) => {
    if (nueva === sucursal) return;
    setSucursal(nueva);
    setPage(1);
    cargar(nueva, fechaInicio, fechaFin, tipoMov, busqueda, 1);
  };

  const preset = (dias: number) => {
    const inicio = dias === 0 ? hoyISO() : diasAtras(dias);
    const fin = hoyISO();
    setFechaInicio(inicio);
    setFechaFin(fin);
    setPage(1);
    cargar(sucursal, inicio, fin, tipoMov, busqueda, 1);
  };

  const cambiarTipo = (tipo: string) => {
    setTipoMov(tipo);
    setPage(1);
    cargar(sucursal, fechaInicio, fechaFin, tipo, busqueda, 1);
  };

  const limpiar = () => {
    setFechaInicio(hoyISO());
    setFechaFin(hoyISO());
    setTipoMov("");
    setBusqueda("");
    setPage(1);
    cargar(sucursal, hoyISO(), hoyISO(), "", "", 1);
  };

  const cambiarPagina = (pagina: number) => {
    setPage(pagina);
    cargar(sucursal, fechaInicio, fechaFin, tipoMov, busqueda, pagina);
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
      if (sucursal === "usadas") qs.set("sucursal", "usadas");
      if (tipoMov) qs.set("tipoMov", tipoMov);
      if (busqueda) qs.set("busqueda", busqueda);
      const res = await fetch(`/api/inventario/kardex?${qs.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error al exportar");
      const filas: Movimiento[] = json.movimientos;

      const esUsadas = sucursal === "usadas";
      const columnas = [
        { header: "Fecha" },
        { header: "Tipo" },
        { header: "Documento" },
        { header: "Código" },
        { header: "Descripción" },
        { header: "Exist. ant.", align: "right" as const },
        { header: "Cantidad", align: "right" as const },
        { header: "Exist. post.", align: "right" as const },
        ...(esUsadas
          ? [
              { header: "Precio", align: "right" as const },
              { header: "Total", align: "right" as const },
            ]
          : [{ header: "Usuario" }]),
      ];
      const base = {
        titulo: `KARDEX DE INVENTARIO${esUsadas ? " · BODEGA USADO" : ""}`,
        subtitulo: `Del ${fechaInicio} al ${fechaFin}${tipoMov ? `  ·  ${tipoMov}` : ""}${
          busqueda ? `  ·  "${busqueda}"` : ""
        }  ·  ${entero(filas.length)} movimientos`,
        columnas,
        nombreArchivo: `kardex_${esUsadas ? "usadas_" : ""}${fechaInicio}_${fechaFin}`,
      };

      // Columnas comunes; las finales cambian por sucursal (usuario vs precios).
      const filaComun = (m: Movimiento) => [
        fechaCorta(m.fecha),
        m.tipoMov,
        esUsadas ? String(m.numDoc ?? "") : `${m.tipoDoc ?? ""} ${m.numDoc ?? ""}`.trim(),
        m.codigo,
        m.descripcion,
      ];

      if (formato === "pdf") {
        const { exportarPdf } = await import("@/lib/export");
        await exportarPdf({
          ...base,
          orientacion: "landscape",
          filas: filas.map((m) => [
            ...filaComun(m),
            entero(m.existAnt),
            entero(m.cantidad),
            entero(m.existPost),
            ...(esUsadas ? [moneda(m.precio ?? 0), moneda(m.total ?? 0)] : [m.usuario ?? ""]),
          ]),
        });
      } else {
        const { exportarExcel } = await import("@/lib/export");
        await exportarExcel({
          ...base,
          hoja: "Kardex",
          filas: filas.map((m) => [
            ...filaComun(m),
            m.existAnt,
            m.cantidad,
            m.existPost,
            ...(esUsadas ? [m.precio ?? 0, m.total ?? 0] : [m.usuario ?? ""]),
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
  const esUsadas = sucursal === "usadas";

  // Colores de tarjetas coherentes con los badges de cada sucursal.
  const tarjetas = resumen
    ? [
        { titulo: "Movimientos", valor: entero(resumen.movimientos), color: "text-slate-200" },
        {
          titulo: "Entradas",
          valor: entero(resumen.entradas),
          color: esUsadas ? "text-cyan-300" : "text-emerald-300",
        },
        {
          titulo: "Salidas por venta",
          valor: entero(resumen.ventas),
          color: esUsadas ? "text-emerald-300" : "text-cyan-300",
        },
        { titulo: "Devoluciones", valor: entero(resumen.devoluciones), color: "text-rose-300" },
        { titulo: "Piezas movidas", valor: entero(resumen.piezas), color: "text-amber-300" },
      ]
    : [];

  return (
    <div className="space-y-4">
      {/* Encabezado */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight">Kardex de inventario</h1>
          <p className={cn(lbl, "mt-1")}>
            {cargando ? "Consultando..." : `${entero(total)} movimientos en el rango`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SelectorSucursal opciones={SUCURSALES} valor={sucursal} onCambio={cambiarSucursal} />
          <button
            onClick={() => exportar("pdf")}
            disabled={!!exportando || cargando || movimientos.length === 0}
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
            disabled={!!exportando || cargando || movimientos.length === 0}
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
              { etiqueta: "Hoy", dias: 0 },
              { etiqueta: "7 días", dias: 7 },
              { etiqueta: "30 días", dias: 30 },
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
          {/* Tabs pill por tipo de movimiento */}
          <div className="flex items-center gap-1.5">
            {TABS_TIPO.map((t) => (
              <button
                key={t.clave}
                onClick={() => cambiarTipo(t.clave)}
                className={cn(
                  "px-3 py-2 rounded-lg border text-[10px] font-black uppercase tracking-widest transition-all",
                  tipoMov === t.clave
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
            onClick={limpiar}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/[0.05] border border-white/10 text-slate-400 text-[11px] font-black uppercase tracking-widest hover:text-white transition-all"
          >
            <ListRestart className="h-3.5 w-3.5" /> Limpiar
          </button>
        </div>
      </div>

      {/* Tarjetas de resumen */}
      {resumen && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
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
        ) : movimientos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3 text-slate-500">
            <Boxes className="h-10 w-10" />
            <p className="text-[11px] font-black uppercase tracking-widest">
              Sin movimientos en el rango seleccionado
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-auto max-h-[calc(100vh-26rem)]">
              <table className="w-full">
                <thead className="sticky top-0 z-10 bg-[#10151f] shadow-[0_1px_0_rgba(255,255,255,0.08)]">
                  <tr>
                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Fecha</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-center")}>Tipo</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Documento</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Código</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Descripción</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Exist. ant.</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Cantidad</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Exist. post.</th>
                    {esUsadas ? (
                      <>
                        <th className={cn(lbl, "px-4 py-2.5 text-right")}>Precio</th>
                        <th className={cn(lbl, "px-4 py-2.5 text-right")}>Total</th>
                      </>
                    ) : (
                      <th className={cn(lbl, "px-4 py-2.5 text-left")}>Usuario</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {movimientos.map((m) => (
                    <tr key={m.id} className="transition-colors hover:bg-white/[0.03]">
                      <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400">
                        {fechaCorta(m.fecha)}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <span
                          className={cn(
                            "text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-lg border",
                            esUsadas ? badgeTipoUsadas(m.tipoMov) : badgeTipo(m.tipoMov)
                          )}
                        >
                          {m.tipoMov}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400 whitespace-nowrap">
                        {esUsadas ? (
                          (m.numDoc ?? "—")
                        ) : (
                          <>
                            {m.tipoDoc ?? "—"}
                            {m.numDoc ? (
                              <span className="text-slate-500 ml-1.5">{m.numDoc}</span>
                            ) : null}
                          </>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-black text-amber-300">
                        {m.codigo}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-bold text-slate-300 max-w-[280px] truncate">
                        {m.descripcion}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-bold text-slate-500 text-right">
                        {entero(m.existAnt)}
                      </td>
                      <td
                        className={cn(
                          "px-4 py-2.5 text-[12px] font-black text-right",
                          esUsadas ? colorCantidadUsadas(m.tipoMov) : colorCantidad(m.tipoMov)
                        )}
                      >
                        {cantidadVisual(m)}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-black text-slate-200 text-right">
                        {entero(m.existPost)}
                      </td>
                      {esUsadas ? (
                        <>
                          <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400 text-right whitespace-nowrap">
                            {moneda(m.precio ?? 0)}
                          </td>
                          <td className="px-4 py-2.5 text-[12px] font-black text-emerald-300 text-right whitespace-nowrap">
                            {moneda(m.total ?? 0)}
                          </td>
                        </>
                      ) : (
                        <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400 max-w-[160px] truncate">
                          {m.usuario ?? "—"}
                        </td>
                      )}
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
