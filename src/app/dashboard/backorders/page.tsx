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
  PackageSearch,
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
interface BackOrder {
  id: number;
  numBko: number;
  fechaBko: string;
  cliente: string;
  telefono: string | null;
  vendedor: string;
  proveedor: string;
  subtotal: number;
  iva: number;
  total: number;
  anticipo: number;
  liquida: number;
  saldo: number;
  estatus: string | null;
  fechaCompromiso: string | null;
  comentarios: string | null;
}

interface Resumen {
  backOrders: number;
  abiertas: number;
  importe: number;
  anticipos: number;
  saldoPorCobrar: number;
}

interface DetalleBackOrder {
  backOrder: BackOrder;
  partidas: {
    partida: number;
    codigo: string;
    descripcion: string;
    cantidad: number;
    precio: number;
    totalPart: number;
    estatus: string | null;
    cantRecibida: number;
    fechaLlegada: string | null;
  }[];
  ventasLigadas: {
    id: number;
    numVenta: number;
    serie: string | null;
    fecha: string;
    total: number;
  }[];
}

// ---------- Constantes de estilo (patrón kyk-server-web) ----------
const lbl = "text-[10px] font-black text-slate-500 uppercase tracking-widest";
const inputCls =
  "block w-full px-4 py-2.5 bg-white/[0.03] border border-white/10 rounded-xl text-sm font-bold text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-400/25 focus:border-amber-400/60 transition-all";

const PAGE_SIZE = 50;

// VENTA/ENTREGADA cerraron bien (emerald), RECIBIDA informa (cyan),
// CANCELADA existe en históricos (rose), ABIERTA/PROCESO/BKO siguen en curso (amber).
const badgeEstatus = (estatus: string | null) =>
  estatus === "VENTA" || estatus === "ENTREGADA"
    ? "text-emerald-300 bg-emerald-500/10 border-emerald-500/25"
    : estatus === "RECIBIDA"
    ? "text-cyan-300 bg-cyan-500/10 border-cyan-500/25"
    : estatus === "CANCELADA"
    ? "text-rose-300 bg-rose-500/10 border-rose-500/25"
    : "text-amber-300 bg-amber-500/10 border-amber-500/25";

export default function BackOrdersPage() {
  const [estatus, setEstatus] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [page, setPage] = useState(1);

  // Sucursal activa. La Bodega Usado no maneja back orders: con "usadas" no se
  // consulta nada, solo se muestra el aviso y se conservan los datos de matriz.
  const [sucursal, setSucursal] = useState<Sucursal>("matriz");
  const esUsadas = sucursal === "usadas";

  const [backOrders, setBackOrders] = useState<BackOrder[]>([]);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [exportando, setExportando] = useState<"pdf" | "excel" | null>(null);

  const [detalle, setDetalle] = useState<DetalleBackOrder | null>(null);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);

  // Token de secuencia: descarta respuestas viejas cuando el usuario cambia
  // filtros/página rápido y llegan varios fetch concurrentes fuera de orden.
  const peticionRef = useRef(0);

  const cargar = useCallback(async (e: string, filtro: string, pagina: number) => {
    const idPeticion = ++peticionRef.current;
    setCargando(true);
    setError("");
    try {
      const qs = new URLSearchParams({
        page: String(pagina),
        pageSize: String(PAGE_SIZE),
      });
      if (e) qs.set("estatus", e);
      if (filtro) qs.set("busqueda", filtro);
      const res = await fetch(`/api/backorders?${qs.toString()}`);
      if (idPeticion !== peticionRef.current) return;
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      const json = await res.json();
      if (idPeticion !== peticionRef.current) return;
      if (!res.ok) throw new Error(json.error || "Error al consultar back orders");
      setBackOrders(json.backOrders);
      setResumen(json.resumen);
      setTotal(json.total);
    } catch (err: unknown) {
      if (idPeticion !== peticionRef.current) return;
      setError(err instanceof Error ? err.message : "Error desconocido");
      setBackOrders([]);
      setResumen(null);
      setTotal(0);
    } finally {
      if (idPeticion === peticionRef.current) setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar("", "", 1);
  }, [cargar]);

  const actualizar = () => {
    setPage(1);
    cargar(estatus, busqueda, 1);
  };

  const limpiar = () => {
    setEstatus("");
    setBusqueda("");
    setPage(1);
    cargar("", "", 1);
  };

  const cambiarPagina = (pagina: number) => {
    setPage(pagina);
    cargar(estatus, busqueda, pagina);
  };

  const verDetalle = async (bko: BackOrder) => {
    setCargandoDetalle(true);
    try {
      const res = await fetch(`/api/backorders/${bko.id}`);
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
      // Trae el listado completo (hasta el tope del servidor) para exportar todo.
      const qs = new URLSearchParams({ page: "1", pageSize: "20000" });
      if (estatus) qs.set("estatus", estatus);
      if (busqueda) qs.set("busqueda", busqueda);
      const res = await fetch(`/api/backorders?${qs.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error al exportar");
      const filas: BackOrder[] = json.backOrders;

      const columnas = [
        { header: "Folio" },
        { header: "Fecha" },
        { header: "Cliente" },
        { header: "Vendedor" },
        { header: "Proveedor" },
        { header: "Subtotal", align: "right" as const },
        { header: "IVA", align: "right" as const },
        { header: "Total", align: "right" as const },
        { header: "Anticipo", align: "right" as const },
        { header: "Saldo", align: "right" as const },
        { header: "Compromiso" },
        { header: "Estatus" },
      ];
      const base = {
        titulo: "REPORTE DE BACK ORDERS",
        subtitulo: `${estatus ? `Estatus ${estatus}  ·  ` : ""}${entero(filas.length)} back orders`,
        columnas,
        nombreArchivo: `backorders_${new Date().toLocaleDateString("sv-SE")}`,
      };

      if (formato === "pdf") {
        const { exportarPdf } = await import("@/lib/export");
        await exportarPdf({
          ...base,
          orientacion: "landscape",
          filas: filas.map((b) => [
            b.numBko,
            fechaCorta(b.fechaBko),
            b.cliente,
            b.vendedor,
            b.proveedor,
            moneda(b.subtotal),
            moneda(b.iva),
            moneda(b.total),
            moneda(b.anticipo),
            moneda(b.saldo),
            b.fechaCompromiso ?? "",
            b.estatus ?? "",
          ]),
        });
      } else {
        const { exportarExcel } = await import("@/lib/export");
        await exportarExcel({
          ...base,
          hoja: "Back Orders",
          columnasMoneda: [5, 6, 7, 8, 9],
          filas: filas.map((b) => [
            b.numBko,
            fechaCorta(b.fechaBko),
            b.cliente,
            b.vendedor,
            b.proveedor,
            b.subtotal,
            b.iva,
            b.total,
            b.anticipo,
            b.saldo,
            b.fechaCompromiso ?? "",
            b.estatus ?? "",
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
        { titulo: "Back orders", valor: entero(resumen.backOrders), color: "text-slate-200" },
        { titulo: "Abiertas / en proceso", valor: entero(resumen.abiertas), color: "text-amber-300" },
        { titulo: "Importe total", valor: moneda(resumen.importe), color: "text-cyan-300" },
        { titulo: "Anticipos recibidos", valor: moneda(resumen.anticipos), color: "text-emerald-300" },
        { titulo: "Saldo por cobrar", valor: moneda(resumen.saldoPorCobrar), color: "text-rose-300" },
      ]
    : [];

  return (
    <div className="space-y-4">
      {/* Encabezado */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight">Back Orders</h1>
          <p className={cn(lbl, "mt-1")}>
            {esUsadas
              ? "Sucursal Bodega Usado"
              : cargando
                ? "Consultando..."
                : `${entero(total)} pedidos especiales`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SelectorSucursal opciones={SUCURSALES} valor={sucursal} onCambio={setSucursal} />
          {!esUsadas && (
            <>
              <button
                onClick={() => exportar("pdf")}
                disabled={!!exportando || cargando || backOrders.length === 0}
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
                disabled={!!exportando || cargando || backOrders.length === 0}
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
            La Bodega Usado no maneja back orders en su sistema.
          </p>
        </div>
      )}

      {/* Filtros (sin fechas: los back orders son pocos y se listan completos; solo matriz) */}
      {!esUsadas && (
      <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-4 backdrop-blur-xl">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <label className={lbl}>Estatus</label>
            <select
              className={cn(inputCls, "w-52 appearance-none [color-scheme:dark]")}
              value={estatus}
              onChange={(e) => setEstatus(e.target.value)}
            >
              <option value="" className="bg-[#0d1320]">Todos</option>
              <option value="ABIERTA" className="bg-[#0d1320]">Abiertas</option>
              <option value="PROCESO" className="bg-[#0d1320]">En proceso</option>
              <option value="RECIBIDA" className="bg-[#0d1320]">Recibidas</option>
              <option value="VENTA" className="bg-[#0d1320]">Convertidas a venta</option>
            </select>
          </div>
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute top-1/2 -translate-y-1/2 left-3.5 h-4 w-4 text-slate-500" />
            <input
              type="text"
              className={cn(inputCls, "pl-10")}
              placeholder="Buscar por cliente o folio..."
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
      )}

      {/* Tarjetas de resumen */}
      {!esUsadas && resumen && (
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
        ) : backOrders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3 text-slate-500">
            <PackageSearch className="h-10 w-10" />
            <p className="text-[11px] font-black uppercase tracking-widest">
              Sin back orders con los filtros seleccionados
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-auto max-h-[calc(100vh-24rem)]">
              <table className="w-full">
                <thead className="sticky top-0 z-10 bg-[#10151f] shadow-[0_1px_0_rgba(255,255,255,0.08)]">
                  <tr>
                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Folio</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Fecha</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Cliente</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Vendedor</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Proveedor</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Total</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Anticipo</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Saldo</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Compromiso</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-center")}>Estatus</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {backOrders.map((b) => (
                    <tr
                      key={b.id}
                      onClick={() => verDetalle(b)}
                      className="cursor-pointer transition-colors hover:bg-white/[0.03]"
                    >
                      <td className="px-4 py-2.5 text-[12px] font-black text-cyan-300">
                        {b.numBko}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400">
                        {fechaCorta(b.fechaBko)}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-bold text-slate-300 max-w-[220px] truncate">
                        {b.cliente}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400">
                        {b.vendedor}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400 max-w-[180px] truncate">
                        {b.proveedor}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-black text-slate-200 text-right">
                        {moneda(b.total)}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400 text-right">
                        {moneda(b.anticipo)}
                      </td>
                      <td
                        className={cn(
                          "px-4 py-2.5 text-[12px] font-black text-right",
                          b.saldo > 0 ? "text-rose-300" : "text-slate-500"
                        )}
                      >
                        {moneda(b.saldo)}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400 uppercase">
                        {b.fechaCompromiso || "—"}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <span
                          className={cn(
                            "text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-lg border",
                            badgeEstatus(b.estatus)
                          )}
                        >
                          {b.estatus ?? "—"}
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
                    Back order {detalle.backOrder.numBko}
                  </h2>
                  <span
                    className={cn(
                      "text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-lg border",
                      badgeEstatus(detalle.backOrder.estatus)
                    )}
                  >
                    {detalle.backOrder.estatus ?? "—"}
                  </span>
                  {detalle.backOrder.fechaCompromiso ? (
                    <span className="text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-lg border text-cyan-300 bg-cyan-500/10 border-cyan-500/25">
                      Compromiso {detalle.backOrder.fechaCompromiso}
                    </span>
                  ) : null}
                </div>
                <p className="text-[11px] font-bold text-slate-400 mt-1.5">
                  {fechaCorta(detalle.backOrder.fechaBko)} · {detalle.backOrder.cliente}
                  {detalle.backOrder.telefono ? ` · ${detalle.backOrder.telefono}` : ""}
                </p>
                <p className="text-[11px] font-bold text-slate-500 mt-0.5">
                  Proveedor {detalle.backOrder.proveedor} · atendió {detalle.backOrder.vendedor}
                </p>
                {detalle.backOrder.comentarios && (
                  <p className="text-[11px] font-bold text-slate-500 mt-1">
                    {detalle.backOrder.comentarios}
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
                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Rec</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Llegada</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Precio</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Importe</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-center")}>Estatus</th>
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
                        {entero(p.cantRecibida)}
                      </td>
                      <td className="px-4 py-2 text-[12px] font-bold text-slate-400">
                        {fechaCorta(p.fechaLlegada) || "—"}
                      </td>
                      <td className="px-4 py-2 text-[12px] font-bold text-slate-400 text-right">
                        {moneda(p.precio)}
                      </td>
                      <td className="px-4 py-2 text-[12px] font-black text-slate-200 text-right">
                        {moneda(p.totalPart)}
                      </td>
                      <td className="px-4 py-2 text-center">
                        <span
                          className={cn(
                            "text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-lg border",
                            badgeEstatus(p.estatus)
                          )}
                        >
                          {p.estatus ?? "—"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pie: ventas ligadas y totales */}
            <div className="p-5 border-t border-white/[0.06] flex flex-wrap items-end justify-between gap-4">
              <div className="space-y-1">
                {detalle.ventasLigadas.length === 0 ? (
                  <p className="text-[11px] font-bold text-slate-500">Sin ventas ligadas</p>
                ) : (
                  detalle.ventasLigadas.map((v) => (
                    <p key={v.id} className="text-[11px] font-bold text-slate-400">
                      <span className="text-slate-500 uppercase text-[9px] font-black tracking-widest mr-2">
                        Venta
                      </span>
                      <span className="text-cyan-300 font-black">
                        {v.serie}-{v.numVenta}
                      </span>{" "}
                      · {fechaCorta(v.fecha)} · {moneda(v.total)}
                    </p>
                  ))
                )}
              </div>
              <div className="text-right space-y-0.5">
                <p className="text-[11px] font-bold text-slate-400">
                  Subtotal{" "}
                  <span className="text-slate-200 ml-2">{moneda(detalle.backOrder.subtotal)}</span>
                </p>
                <p className="text-[11px] font-bold text-slate-400">
                  IVA <span className="text-slate-200 ml-2">{moneda(detalle.backOrder.iva)}</span>
                </p>
                <p className="text-base font-black text-amber-300">
                  Total <span className="ml-2">{moneda(detalle.backOrder.total)}</span>
                </p>
                <p className="text-[11px] font-bold text-emerald-300">
                  Anticipo <span className="ml-2">{moneda(detalle.backOrder.anticipo)}</span>
                </p>
                {detalle.backOrder.liquida > 0 && (
                  <p className="text-[11px] font-bold text-slate-400">
                    Liquidó{" "}
                    <span className="text-slate-200 ml-2">{moneda(detalle.backOrder.liquida)}</span>
                  </p>
                )}
                {detalle.backOrder.saldo > 0 && (
                  <p className="text-[11px] font-black text-rose-300">
                    Saldo pendiente {moneda(detalle.backOrder.saldo)}
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
