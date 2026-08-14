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
  Receipt,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { moneda, entero, fechaCorta } from "@/lib/formato";
import {
  SelectorSucursal,
  SUCURSALES,
  type Sucursal,
} from "@/components/dashboard/SelectorSucursal";

// ---------- Tipos ----------
interface Factura {
  id: number;
  numFactura: string;
  fechaFactura: string;
  proveedor: string;
  numCompra: number;
  subtotal: number;
  iva: number;
  total: number;
  saldo: number;
  estatus: string | null;
  comentarios: string | null;
}

interface Resumen {
  facturas: number;
  importe: number;
  saldoPendiente: number;
}

interface DetalleFactura {
  factura: {
    id: number;
    numFactura: string;
    fechaFactura: string;
    proveedor: string;
    numCompra: number;
    fechaCompra: string | null;
    subtotal: number;
    iva: number;
    total: number;
    saldo: number;
    estatus: string | null;
    comentarios: string | null;
  };
  partidas: {
    partida: number;
    codigo: string;
    descripcion: string;
    cantidad: number;
    precioCompra: number;
    totalPart: number;
  }[];
}

// ---------- Constantes de estilo (patrón kyk-server-web) ----------
const lbl = "text-[10px] font-black text-slate-500 uppercase tracking-widest";
const inputCls =
  "block w-full px-4 py-2.5 bg-white/[0.03] border border-white/10 rounded-xl text-sm font-bold text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-400/25 focus:border-amber-400/60 transition-all";

const PAGE_SIZE = 50;

const hoyISO = () => new Date().toLocaleDateString("sv-SE");
const diasAtras = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString("sv-SE");
};

// El estatus de facturas de compra es texto libre: se mapea a la paleta estándar.
const claseBadge = (estatus: string | null) =>
  estatus === "PAGADA" || estatus === "COMPLETO"
    ? "text-emerald-300 bg-emerald-500/10 border-emerald-500/25"
    : estatus === "VIGENTE"
    ? "text-amber-300 bg-amber-500/10 border-amber-500/25"
    : estatus === "CANCELADA"
    ? "text-rose-300 bg-rose-500/10 border-rose-500/25"
    : "text-cyan-300 bg-cyan-500/10 border-cyan-500/25";

export default function FacturasComprasPage() {
  const [fechaInicio, setFechaInicio] = useState(diasAtras(30));
  const [fechaFin, setFechaFin] = useState(hoyISO());
  const [busqueda, setBusqueda] = useState("");
  const [page, setPage] = useState(1);

  // Sucursal activa. La Bodega Usado no maneja facturas de compra: con "usadas"
  // no se consulta nada, solo se muestra el aviso y se conservan los datos de matriz.
  const [sucursal, setSucursal] = useState<Sucursal>("matriz");
  const esUsadas = sucursal === "usadas";

  const [facturas, setFacturas] = useState<Factura[]>([]);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [exportando, setExportando] = useState<"pdf" | "excel" | null>(null);

  const [detalle, setDetalle] = useState<DetalleFactura | null>(null);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);

  // Token de secuencia: descarta respuestas de peticiones obsoletas (condición de carrera).
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
        const res = await fetch(`/api/compras/facturas?${qs.toString()}`);
        if (idPeticion !== peticionRef.current) return;
        if (res.status === 401) {
          window.location.href = "/login";
          return;
        }
        const json = await res.json();
        if (idPeticion !== peticionRef.current) return;
        if (!res.ok) throw new Error(json.error || "Error al consultar facturas");
        setFacturas(json.facturas);
        setResumen(json.resumen);
        setTotal(json.total);
      } catch (err: unknown) {
        if (idPeticion !== peticionRef.current) return;
        setError(err instanceof Error ? err.message : "Error desconocido");
        setFacturas([]);
        setResumen(null);
        setTotal(0);
      } finally {
        if (idPeticion === peticionRef.current) setCargando(false);
      }
    },
    []
  );

  useEffect(() => {
    cargar(diasAtras(30), hoyISO(), "", 1);
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
    setFechaInicio(diasAtras(30));
    setFechaFin(hoyISO());
    setBusqueda("");
    setPage(1);
    cargar(diasAtras(30), hoyISO(), "", 1);
  };

  const cambiarPagina = (pagina: number) => {
    setPage(pagina);
    cargar(fechaInicio, fechaFin, busqueda, pagina);
  };

  const verDetalle = async (factura: Factura) => {
    setCargandoDetalle(true);
    try {
      const res = await fetch(`/api/compras/facturas/${factura.id}`);
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
      const res = await fetch(`/api/compras/facturas?${qs.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error al exportar");
      const filas: Factura[] = json.facturas;

      const columnas = [
        { header: "Factura" },
        { header: "Fecha" },
        { header: "Proveedor" },
        { header: "Compra" },
        { header: "Subtotal", align: "right" as const },
        { header: "IVA", align: "right" as const },
        { header: "Total", align: "right" as const },
        { header: "Saldo", align: "right" as const },
        { header: "Estatus" },
      ];
      const base = {
        titulo: "REPORTE DE FACTURAS DE COMPRA",
        subtitulo: `Del ${fechaInicio} al ${fechaFin}${
          busqueda ? `  ·  Factura "${busqueda}"` : ""
        }  ·  ${entero(filas.length)} facturas`,
        columnas,
        nombreArchivo: `facturas_compras_${fechaInicio}_${fechaFin}`,
      };

      if (formato === "pdf") {
        const { exportarPdf } = await import("@/lib/export");
        await exportarPdf({
          ...base,
          orientacion: "landscape",
          filas: filas.map((f) => [
            f.numFactura,
            fechaCorta(f.fechaFactura),
            f.proveedor,
            f.numCompra,
            moneda(f.subtotal),
            moneda(f.iva),
            moneda(f.total),
            moneda(f.saldo),
            f.estatus ?? "",
          ]),
        });
      } else {
        const { exportarExcel } = await import("@/lib/export");
        await exportarExcel({
          ...base,
          hoja: "Facturas",
          columnasMoneda: [4, 5, 6, 7],
          filas: filas.map((f) => [
            f.numFactura,
            fechaCorta(f.fechaFactura),
            f.proveedor,
            f.numCompra,
            f.subtotal,
            f.iva,
            f.total,
            f.saldo,
            f.estatus ?? "",
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
        { titulo: "Facturas", valor: entero(resumen.facturas), color: "text-slate-200" },
        { titulo: "Importe", valor: moneda(resumen.importe), color: "text-amber-300" },
        { titulo: "Saldo pendiente", valor: moneda(resumen.saldoPendiente), color: "text-rose-300" },
      ]
    : [];

  return (
    <div className="space-y-4">
      {/* Encabezado */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight">Facturas de compra</h1>
          <p className={cn(lbl, "mt-1")}>
            {esUsadas
              ? "Sucursal Bodega Usado"
              : cargando
                ? "Consultando..."
                : `${entero(total)} facturas en el rango`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SelectorSucursal opciones={SUCURSALES} valor={sucursal} onCambio={setSucursal} />
          {!esUsadas && (
            <>
              <button
                onClick={() => exportar("pdf")}
                disabled={!!exportando || cargando || facturas.length === 0}
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
                disabled={!!exportando || cargando || facturas.length === 0}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/[0.05] border border-white/10 text-slate-300 text-[11px] font-black uppercase tracking-widest hover:text-emerald-300 transition-all disabled:opacity-40"
              >
                {exportando === "excel" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                )}
                Excel
              </button>
            </>
          )}
        </div>
      </div>

      {/* Bodega Usado: módulo sin equivalente, solo se muestra el aviso */}
      {esUsadas && (
        <div className="bg-white/[0.04] border border-white/10 rounded-2xl backdrop-blur-xl flex flex-col items-center justify-center text-center gap-3 py-24 px-6">
          <span className="text-4xl" aria-hidden="true">
            ♻️
          </span>
          <p className="text-sm font-bold text-slate-400 max-w-md">
            La Bodega Usado no maneja facturas de compra en su sistema.
          </p>
        </div>
      )}

      {/* Filtros (solo matriz) */}
      {!esUsadas && (
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
              placeholder="Buscar por número de factura..."
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
      )}

      {/* Tarjetas de resumen */}
      {!esUsadas && resumen && (
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
      {!esUsadas && error && (
        <div className="flex items-center gap-2 text-rose-300 text-[11px] font-black bg-rose-500/10 p-3 rounded-xl border border-rose-500/25 uppercase tracking-wider">
          <AlertTriangle className="h-4 w-4" /> {error}
        </div>
      )}

      {/* Tabla (solo matriz) */}
      {!esUsadas && (
      <div className="bg-white/[0.04] border border-white/10 rounded-2xl backdrop-blur-xl overflow-hidden">
        {cargando ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-8 w-8 text-amber-400 animate-spin" />
          </div>
        ) : facturas.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3 text-slate-500">
            <Receipt className="h-10 w-10" />
            <p className="text-[11px] font-black uppercase tracking-widest">
              Sin facturas en el rango seleccionado
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-auto max-h-[calc(100vh-26rem)]">
              <table className="w-full">
                <thead className="sticky top-0 z-10 bg-[#10151f] shadow-[0_1px_0_rgba(255,255,255,0.08)]">
                  <tr>
                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Factura</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Fecha</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Proveedor</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Compra</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Subtotal</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>IVA</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Total</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Saldo</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-center")}>Estatus</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {facturas.map((f) => (
                    <tr
                      key={f.id}
                      onClick={() => verDetalle(f)}
                      className="cursor-pointer transition-colors hover:bg-white/[0.03]"
                    >
                      <td className="px-4 py-2.5 text-[12px] font-black text-cyan-300">
                        {f.numFactura}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400">
                        {fechaCorta(f.fechaFactura)}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-bold text-slate-300 max-w-[240px] truncate">
                        {f.proveedor}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400 text-right">
                        {f.numCompra}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400 text-right">
                        {moneda(f.subtotal)}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400 text-right">
                        {moneda(f.iva)}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-black text-slate-200 text-right">
                        {moneda(f.total)}
                      </td>
                      <td
                        className={cn(
                          "px-4 py-2.5 text-[12px] font-black text-right",
                          f.saldo > 0 ? "text-rose-300" : "text-slate-500"
                        )}
                      >
                        {moneda(f.saldo)}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <span
                          className={cn(
                            "text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-lg border",
                            claseBadge(f.estatus)
                          )}
                        >
                          {f.estatus ?? "—"}
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
      )}

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
                    Factura {detalle.factura.numFactura}
                  </h2>
                  <span
                    className={cn(
                      "text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-lg border",
                      claseBadge(detalle.factura.estatus)
                    )}
                  >
                    {detalle.factura.estatus ?? "—"}
                  </span>
                  <span className="text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-lg border text-cyan-300 bg-cyan-500/10 border-cyan-500/25">
                    Compra {detalle.factura.numCompra}
                  </span>
                </div>
                <p className="text-[11px] font-bold text-slate-400 mt-1.5">
                  {fechaCorta(detalle.factura.fechaFactura)} · {detalle.factura.proveedor}
                </p>
                {detalle.factura.comentarios && (
                  <p className="text-[11px] font-bold text-slate-500 mt-1">
                    {detalle.factura.comentarios}
                  </p>
                )}
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
                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Precio compra</th>
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
                      </td>
                      <td className="px-4 py-2 text-[12px] font-black text-slate-200 text-right">
                        {entero(p.cantidad)}
                      </td>
                      <td className="px-4 py-2 text-[12px] font-bold text-slate-400 text-right">
                        {moneda(p.precioCompra)}
                      </td>
                      <td className="px-4 py-2 text-[12px] font-black text-slate-200 text-right">
                        {moneda(p.totalPart)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pie: totales */}
            <div className="p-5 border-t border-white/[0.06] flex flex-wrap items-end justify-end gap-4">
              <div className="text-right space-y-0.5">
                <p className="text-[11px] font-bold text-slate-400">
                  Subtotal <span className="text-slate-200 ml-2">{moneda(detalle.factura.subtotal)}</span>
                </p>
                <p className="text-[11px] font-bold text-slate-400">
                  IVA <span className="text-slate-200 ml-2">{moneda(detalle.factura.iva)}</span>
                </p>
                <p className="text-base font-black text-amber-300">
                  Total <span className="ml-2">{moneda(detalle.factura.total)}</span>
                </p>
                {detalle.factura.saldo > 0 && (
                  <p className="text-[11px] font-black text-rose-300">
                    Saldo pendiente {moneda(detalle.factura.saldo)}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
