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
  Users,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { moneda, entero, fechaCorta } from "@/lib/formato";

// ---------- Tipos ----------
interface Cliente {
  id: number;
  nombre: string;
  rfc: string | null;
  telefono: string | null;
  ciudad: string | null;
  estado: string | null;
  descuento: number;
  limiteCredito: number;
  saldo: number;
  activo: number;
  bloqueado: number;
}

interface Resumen {
  clientes: number;
  conSaldo: number;
  cartera: number;
  descuentoPromedio: number;
}

interface DetalleCliente {
  cliente: {
    id: number;
    nombre: string;
    rfc: string | null;
    telefono: string | null;
    email: string | null;
    calle: string | null;
    numero: string | null;
    colonia: string | null;
    codpost: string | null;
    ciudad: string | null;
    estado: string | null;
    descuento: number;
    limiteCredito: number;
    saldo: number;
    activo: number;
    bloqueado: number;
  };
  ultimasVentas: {
    numVenta: number;
    serie: string | null;
    fecha: string;
    total: number;
    saldo: number;
    estatus: string | null;
  }[];
  pagos: {
    numPago: number;
    fechaPago: string;
    formaPago: string | null;
    numReferencia: string | null;
    totalPago: number;
    estatusPago: string | null;
  }[];
  totales: { ventas: number; importe: number } | null;
}

// ---------- Constantes de estilo (patrón kyk-server-web) ----------
const lbl = "text-[10px] font-black text-slate-500 uppercase tracking-widest";
const inputCls =
  "block w-full px-4 py-2.5 bg-white/[0.03] border border-white/10 rounded-xl text-sm font-bold text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-400/25 focus:border-amber-400/60 transition-all";

const PAGE_SIZE = 50;

const hoyISO = () => new Date().toLocaleDateString("sv-SE");

/** Color del badge según la familia del estatus (ventas y pagos del detalle). */
const claseEstatus = (estatus: string | null) => {
  const e = (estatus ?? "").toUpperCase();
  if (["PAGADA", "COMPLETO", "VENTA", "RECIBIDA"].includes(e))
    return "text-emerald-300 bg-emerald-500/10 border-emerald-500/25";
  if (["VIGENTE", "ABIERTO", "ABIERTA", "PROCESO"].includes(e))
    return "text-amber-300 bg-amber-500/10 border-amber-500/25";
  if (["CANCELADA", "INCOMPLETO"].includes(e))
    return "text-rose-300 bg-rose-500/10 border-rose-500/25";
  return "text-cyan-300 bg-cyan-500/10 border-cyan-500/25";
};

const estatusCliente = (c: { activo: number; bloqueado: number }) => {
  const partes: string[] = [];
  if (c.bloqueado === 1) partes.push("BLOQUEADO");
  if (c.activo === 0) partes.push("INACTIVO");
  return partes.length > 0 ? partes.join(" · ") : "ACTIVO";
};

export default function ClientesPage() {
  const [busqueda, setBusqueda] = useState("");
  const [conSaldo, setConSaldo] = useState(false);
  const [incluirInactivos, setIncluirInactivos] = useState(false);
  const [page, setPage] = useState(1);

  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [exportando, setExportando] = useState<"pdf" | "excel" | null>(null);

  const [detalle, setDetalle] = useState<DetalleCliente | null>(null);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);

  // Token de secuencia: descarta respuestas viejas del listado que llegan tarde.
  const peticionRef = useRef(0);

  const cargar = useCallback(
    async (filtro: string, soloSaldo: boolean, inactivos: boolean, pagina: number) => {
      const idPeticion = ++peticionRef.current;
      setCargando(true);
      setError("");
      try {
        const qs = new URLSearchParams({
          page: String(pagina),
          pageSize: String(PAGE_SIZE),
        });
        if (filtro) qs.set("busqueda", filtro);
        if (soloSaldo) qs.set("conSaldo", "1");
        if (inactivos) qs.set("incluirInactivos", "1");
        const res = await fetch(`/api/clientes?${qs.toString()}`);
        if (idPeticion !== peticionRef.current) return;
        if (res.status === 401) {
          window.location.href = "/login";
          return;
        }
        const json = await res.json();
        if (idPeticion !== peticionRef.current) return;
        if (!res.ok) throw new Error(json.error || "Error al consultar clientes");
        setClientes(json.clientes);
        setResumen(json.resumen);
        setTotal(json.total);
      } catch (err: unknown) {
        if (idPeticion !== peticionRef.current) return;
        setError(err instanceof Error ? err.message : "Error desconocido");
        setClientes([]);
        setResumen(null);
        setTotal(0);
      } finally {
        if (idPeticion === peticionRef.current) setCargando(false);
      }
    },
    []
  );

  useEffect(() => {
    cargar("", false, false, 1);
  }, [cargar]);

  const actualizar = () => {
    setPage(1);
    cargar(busqueda, conSaldo, incluirInactivos, 1);
  };

  const alternarConSaldo = () => {
    const nuevo = !conSaldo;
    setConSaldo(nuevo);
    setPage(1);
    cargar(busqueda, nuevo, incluirInactivos, 1);
  };

  const alternarInactivos = () => {
    const nuevo = !incluirInactivos;
    setIncluirInactivos(nuevo);
    setPage(1);
    cargar(busqueda, conSaldo, nuevo, 1);
  };

  const limpiar = () => {
    setBusqueda("");
    setConSaldo(false);
    setIncluirInactivos(false);
    setPage(1);
    cargar("", false, false, 1);
  };

  const cambiarPagina = (pagina: number) => {
    setPage(pagina);
    cargar(busqueda, conSaldo, incluirInactivos, pagina);
  };

  const verDetalle = async (cliente: Cliente) => {
    setCargandoDetalle(true);
    try {
      const res = await fetch(`/api/clientes/${cliente.id}`);
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
      // Trae el padrón completo (hasta el tope del servidor) para exportar todo.
      const qs = new URLSearchParams({ page: "1", pageSize: "20000" });
      if (busqueda) qs.set("busqueda", busqueda);
      if (conSaldo) qs.set("conSaldo", "1");
      if (incluirInactivos) qs.set("incluirInactivos", "1");
      const res = await fetch(`/api/clientes?${qs.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error al exportar");
      const filas: Cliente[] = json.clientes;

      const columnas = [
        { header: "Cliente" },
        { header: "RFC" },
        { header: "Teléfono" },
        { header: "Ciudad" },
        { header: "Desc. %", align: "right" as const },
        { header: "Límite crédito", align: "right" as const },
        { header: "Saldo", align: "right" as const },
        { header: "Estatus" },
      ];
      const base = {
        titulo: "REPORTE DE CLIENTES",
        subtitulo: `${entero(filas.length)} clientes${conSaldo ? "  ·  Solo con saldo" : ""}${
          incluirInactivos ? "  ·  Incluye inactivos" : ""
        }${busqueda ? `  ·  Filtro: ${busqueda}` : ""}`,
        columnas,
        nombreArchivo: `clientes_${hoyISO()}`,
      };

      if (formato === "pdf") {
        const { exportarPdf } = await import("@/lib/export");
        await exportarPdf({
          ...base,
          orientacion: "landscape",
          filas: filas.map((c) => [
            c.nombre,
            c.rfc ?? "",
            c.telefono ?? "",
            c.ciudad ?? "",
            `${entero(c.descuento)}%`,
            moneda(c.limiteCredito),
            moneda(c.saldo),
            estatusCliente(c),
          ]),
        });
      } else {
        const { exportarExcel } = await import("@/lib/export");
        await exportarExcel({
          ...base,
          hoja: "Clientes",
          columnasMoneda: [5, 6],
          filas: filas.map((c) => [
            c.nombre,
            c.rfc ?? "",
            c.telefono ?? "",
            c.ciudad ?? "",
            c.descuento,
            c.limiteCredito,
            c.saldo,
            estatusCliente(c),
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
        { titulo: "Clientes", valor: entero(resumen.clientes), color: "text-slate-200" },
        { titulo: "Con saldo", valor: entero(resumen.conSaldo), color: "text-cyan-300" },
        { titulo: "Cartera", valor: moneda(resumen.cartera), color: "text-rose-300" },
        {
          titulo: "Descuento prom.",
          valor: `${resumen.descuentoPromedio.toFixed(1)}%`,
          color: "text-amber-300",
        },
      ]
    : [];

  const direccion = detalle
    ? [
        [detalle.cliente.calle, detalle.cliente.numero].filter(Boolean).join(" "),
        detalle.cliente.colonia,
        detalle.cliente.codpost ? `CP ${detalle.cliente.codpost}` : null,
        detalle.cliente.ciudad,
        detalle.cliente.estado,
      ]
        .filter(Boolean)
        .join(", ")
    : "";

  return (
    <div className="space-y-4">
      {/* Encabezado */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight">Clientes</h1>
          <p className={cn(lbl, "mt-1")}>
            {cargando ? "Consultando..." : `${entero(total)} clientes con los filtros`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => exportar("pdf")}
            disabled={!!exportando || cargando || clientes.length === 0}
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
            disabled={!!exportando || cargando || clientes.length === 0}
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
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute top-1/2 -translate-y-1/2 left-3.5 h-4 w-4 text-slate-500" />
            <input
              type="text"
              className={cn(inputCls, "pl-10")}
              placeholder="Buscar por nombre, RFC o teléfono..."
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && actualizar()}
            />
          </div>
          <button
            onClick={alternarConSaldo}
            className={cn(
              "px-4 py-2.5 rounded-xl border text-[11px] font-black uppercase tracking-widest transition-all",
              conSaldo
                ? "bg-amber-500/15 border-amber-500/40 text-amber-300"
                : "bg-white/[0.05] border-white/10 text-slate-400 hover:text-amber-300"
            )}
          >
            Solo con saldo
          </button>
          <button
            onClick={alternarInactivos}
            className={cn(
              "px-4 py-2.5 rounded-xl border text-[11px] font-black uppercase tracking-widest transition-all",
              incluirInactivos
                ? "bg-amber-500/15 border-amber-500/40 text-amber-300"
                : "bg-white/[0.05] border-white/10 text-slate-400 hover:text-amber-300"
            )}
          >
            Incluir inactivos
          </button>
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
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
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
        ) : clientes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3 text-slate-500">
            <Users className="h-10 w-10" />
            <p className="text-[11px] font-black uppercase tracking-widest">
              Sin clientes con los filtros seleccionados
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-auto max-h-[calc(100vh-24rem)]">
              <table className="w-full">
                <thead className="sticky top-0 z-10 bg-[#10151f] shadow-[0_1px_0_rgba(255,255,255,0.08)]">
                  <tr>
                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Cliente</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>RFC</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Teléfono</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Ciudad</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Desc.</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Límite crédito</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Saldo</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-center")}>Estatus</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {clientes.map((c) => (
                    <tr
                      key={c.id}
                      onClick={() => verDetalle(c)}
                      className="cursor-pointer transition-colors hover:bg-white/[0.03]"
                    >
                      <td className="px-4 py-2.5 text-[12px] font-black text-slate-200 max-w-[260px] truncate">
                        {c.nombre}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-bold text-cyan-300">
                        {c.rfc ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400">
                        {c.telefono ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400 max-w-[160px] truncate">
                        {c.ciudad ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400 text-right">
                        {entero(c.descuento)}%
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400 text-right">
                        {moneda(c.limiteCredito)}
                      </td>
                      <td
                        className={cn(
                          "px-4 py-2.5 text-[12px] font-black text-right",
                          c.saldo > 0 ? "text-rose-300" : "text-slate-500"
                        )}
                      >
                        {moneda(c.saldo)}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <span className="inline-flex items-center gap-1">
                          {c.bloqueado === 1 && (
                            <span className="text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-lg border text-rose-300 bg-rose-500/10 border-rose-500/25">
                              Bloqueado
                            </span>
                          )}
                          {c.activo === 0 && (
                            <span className="text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-lg border text-slate-400 bg-slate-500/10 border-slate-500/25">
                              Inactivo
                            </span>
                          )}
                          {c.bloqueado === 0 && c.activo === 1 && (
                            <span className="text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-lg border text-emerald-300 bg-emerald-500/10 border-emerald-500/25">
                              Activo
                            </span>
                          )}
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
                  <h2 className="text-lg font-black text-white">{detalle.cliente.nombre}</h2>
                  {detalle.cliente.bloqueado === 1 && (
                    <span className="text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-lg border text-rose-300 bg-rose-500/10 border-rose-500/25">
                      Bloqueado
                    </span>
                  )}
                  {detalle.cliente.activo === 0 && (
                    <span className="text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-lg border text-slate-400 bg-slate-500/10 border-slate-500/25">
                      Inactivo
                    </span>
                  )}
                  {detalle.cliente.bloqueado === 0 && detalle.cliente.activo === 1 && (
                    <span className="text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-lg border text-emerald-300 bg-emerald-500/10 border-emerald-500/25">
                      Activo
                    </span>
                  )}
                </div>
                <p className="text-[11px] font-bold text-slate-400 mt-1.5">
                  {detalle.cliente.rfc ?? "Sin RFC"}
                  {detalle.cliente.telefono ? ` · ${detalle.cliente.telefono}` : ""}
                  {detalle.cliente.email ? ` · ${detalle.cliente.email}` : ""}
                </p>
                {direccion && (
                  <p className="text-[11px] font-bold text-slate-500 mt-1">{direccion}</p>
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

            {/* Cuerpo del modal */}
            <div className="flex-1 overflow-auto">
              {/* Datos de crédito e históricos */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 p-5">
                <div>
                  <p className={lbl}>Descuento</p>
                  <p className="text-sm font-black text-amber-300 mt-1">
                    {entero(detalle.cliente.descuento)}%
                  </p>
                </div>
                <div>
                  <p className={lbl}>Límite crédito</p>
                  <p className="text-sm font-black text-slate-200 mt-1">
                    {moneda(detalle.cliente.limiteCredito)}
                  </p>
                </div>
                <div>
                  <p className={lbl}>Saldo</p>
                  <p
                    className={cn(
                      "text-sm font-black mt-1",
                      detalle.cliente.saldo > 0 ? "text-rose-300" : "text-slate-500"
                    )}
                  >
                    {moneda(detalle.cliente.saldo)}
                  </p>
                </div>
                <div>
                  <p className={lbl}>Ventas hist.</p>
                  <p className="text-sm font-black text-slate-200 mt-1">
                    {entero(detalle.totales?.ventas ?? 0)}
                  </p>
                </div>
                <div>
                  <p className={lbl}>Importe hist.</p>
                  <p className="text-sm font-black text-amber-300 mt-1">
                    {moneda(detalle.totales?.importe ?? 0)}
                  </p>
                </div>
              </div>

              {/* Últimas ventas */}
              <p className={cn(lbl, "px-5 pt-2")}>Últimas ventas</p>
              {detalle.ultimasVentas.length === 0 ? (
                <p className="px-5 py-3 text-[11px] font-bold text-slate-500">
                  Sin ventas registradas
                </p>
              ) : (
                <table className="w-full mt-1">
                  <thead className="bg-[#141a28]">
                    <tr>
                      <th className={cn(lbl, "px-5 py-2 text-left")}>Folio</th>
                      <th className={cn(lbl, "px-4 py-2 text-left")}>Fecha</th>
                      <th className={cn(lbl, "px-4 py-2 text-right")}>Total</th>
                      <th className={cn(lbl, "px-4 py-2 text-right")}>Saldo</th>
                      <th className={cn(lbl, "px-4 py-2 text-center")}>Estatus</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04]">
                    {detalle.ultimasVentas.map((v) => (
                      <tr key={`${v.serie}-${v.numVenta}`}>
                        <td className="px-5 py-2 text-[12px] font-black text-cyan-300">
                          {v.serie}-{v.numVenta}
                        </td>
                        <td className="px-4 py-2 text-[12px] font-bold text-slate-400">
                          {fechaCorta(v.fecha)}
                        </td>
                        <td className="px-4 py-2 text-[12px] font-black text-slate-200 text-right">
                          {moneda(v.total)}
                        </td>
                        <td
                          className={cn(
                            "px-4 py-2 text-[12px] font-black text-right",
                            v.saldo > 0 ? "text-rose-300" : "text-slate-500"
                          )}
                        >
                          {moneda(v.saldo)}
                        </td>
                        <td className="px-4 py-2 text-center">
                          <span
                            className={cn(
                              "text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-lg border",
                              claseEstatus(v.estatus)
                            )}
                          >
                            {v.estatus ?? "—"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {/* Pagos */}
              <p className={cn(lbl, "px-5 pt-4")}>Pagos y abonos</p>
              {detalle.pagos.length === 0 ? (
                <p className="px-5 py-3 text-[11px] font-bold text-slate-500">
                  Sin pagos registrados
                </p>
              ) : (
                <table className="w-full mt-1 mb-4">
                  <thead className="bg-[#141a28]">
                    <tr>
                      <th className={cn(lbl, "px-5 py-2 text-left")}>Pago</th>
                      <th className={cn(lbl, "px-4 py-2 text-left")}>Fecha</th>
                      <th className={cn(lbl, "px-4 py-2 text-left")}>Forma</th>
                      <th className={cn(lbl, "px-4 py-2 text-left")}>Referencia</th>
                      <th className={cn(lbl, "px-4 py-2 text-right")}>Importe</th>
                      <th className={cn(lbl, "px-4 py-2 text-center")}>Estatus</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04]">
                    {detalle.pagos.map((p, i) => (
                      <tr key={`${p.numPago}-${i}`}>
                        <td className="px-5 py-2 text-[12px] font-black text-cyan-300">
                          {p.numPago}
                        </td>
                        <td className="px-4 py-2 text-[12px] font-bold text-slate-400">
                          {fechaCorta(p.fechaPago)}
                        </td>
                        <td className="px-4 py-2 text-[12px] font-bold text-slate-300">
                          {p.formaPago ?? "—"}
                        </td>
                        <td className="px-4 py-2 text-[12px] font-bold text-slate-400">
                          {p.numReferencia ?? "—"}
                        </td>
                        <td className="px-4 py-2 text-[12px] font-black text-emerald-300 text-right">
                          {moneda(p.totalPago)}
                        </td>
                        <td className="px-4 py-2 text-center">
                          <span
                            className={cn(
                              "text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-lg border",
                              claseEstatus(p.estatusPago)
                            )}
                          >
                            {p.estatusPago ?? "—"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
