"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { moneda, entero, fechaCorta } from "@/lib/formato";

interface DatosPrincipal {
  hoy: { ventasHoy: number; totalHoy: number; cotizacionesHoy: number };
  meses: { mes: string; ventas: number; total: number }[];
  inventario: { codigosConExistencia: number; valorInventario: number };
  cartera: { clientesConSaldo: number; cartera: number };
  pedidosAbiertos: number;
  ventasRecientes: {
    id: number;
    numVenta: number;
    serie: string | null;
    fecha: string;
    total: number;
    estatus: string | null;
    cliente: string;
  }[];
  topArticulos: { codigo: string; descripcion: string; piezas: number; importe: number }[];
}

const lbl = "text-[10px] font-black text-slate-500 uppercase tracking-widest";

const MESES_CORTOS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

function etiquetaMes(mes: string): string {
  const [, m] = mes.split("-");
  return MESES_CORTOS[Number(m) - 1] ?? mes;
}

export default function DashboardPrincipal() {
  const [datos, setDatos] = useState<DatosPrincipal | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      const res = await fetch("/api/dashboard/principal");
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error al consultar el dashboard");
      setDatos(json);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const maxMes = Math.max(1, ...(datos?.meses.map((m) => m.total) ?? [1]));

  const tarjetas = datos
    ? [
        {
          titulo: "Ventas de hoy",
          valor: entero(datos.hoy.ventasHoy),
          detalle: moneda(datos.hoy.totalHoy),
          color: "text-amber-300",
        },
        {
          titulo: "Cotizaciones de hoy",
          valor: entero(datos.hoy.cotizacionesHoy),
          detalle: "capturadas",
          color: "text-cyan-300",
        },
        {
          titulo: "Valor de inventario",
          valor: moneda(datos.inventario.valorInventario),
          detalle: `${entero(datos.inventario.codigosConExistencia)} códigos con existencia`,
          color: "text-emerald-300",
        },
        {
          titulo: "Cartera de clientes",
          valor: moneda(datos.cartera.cartera),
          detalle: `${entero(datos.cartera.clientesConSaldo)} clientes con saldo`,
          color: "text-rose-300",
        },
        {
          titulo: "Pedidos abiertos",
          valor: entero(datos.pedidosAbiertos),
          detalle: "a proveedor",
          color: "text-violet-300",
        },
      ]
    : [];

  return (
    <div className="space-y-4">
      {/* Encabezado */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight">Panel Principal</h1>
          <p className={cn(lbl, "mt-1")}>
            {cargando ? "Consultando..." : "Resumen operativo de Auto Partes Vidaurri"}
          </p>
        </div>
        <button
          onClick={cargar}
          disabled={cargando}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/[0.05] border border-white/10 text-slate-300 text-[11px] font-black uppercase tracking-widest hover:text-amber-300 transition-all disabled:opacity-40"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", cargando && "animate-spin")} /> Actualizar
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-rose-300 text-[11px] font-black bg-rose-500/10 p-3 rounded-xl border border-rose-500/25 uppercase tracking-wider">
          <AlertTriangle className="h-4 w-4" /> {error}
        </div>
      )}

      {cargando && !datos ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 text-amber-400 animate-spin" />
        </div>
      ) : datos ? (
        <>
          {/* Tarjetas KPI */}
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

          {/* Gráfica de ventas por mes (12 meses) */}
          <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-4 backdrop-blur-xl">
            <p className={cn(lbl, "mb-4")}>Ventas de los últimos 12 meses</p>
            <div className="flex items-end gap-2 h-44">
              {datos.meses.map((m) => (
                <div key={m.mes} className="flex-1 flex flex-col items-center gap-1 min-w-0 group">
                  <span className="text-[9px] font-black text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                    {moneda(m.total)}
                  </span>
                  <div
                    className="w-full rounded-t-lg bg-gradient-to-t from-amber-600/70 to-amber-400/90 hover:from-amber-500 hover:to-orange-400 transition-colors min-h-[3px]"
                    style={{ height: `${Math.round((m.total / maxMes) * 100)}%` }}
                    title={`${m.mes}: ${moneda(m.total)} (${entero(m.ventas)} ventas)`}
                  />
                  <span className="text-[9px] font-black text-slate-500 uppercase">
                    {etiquetaMes(m.mes)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            {/* Últimas ventas */}
            <div className="bg-white/[0.04] border border-white/10 rounded-2xl backdrop-blur-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 pt-4 pb-2">
                <p className={lbl}>Últimas ventas</p>
                <Link
                  href="/dashboard/ventas"
                  className="text-[10px] font-black text-amber-300 uppercase tracking-widest hover:text-amber-200"
                >
                  Ver todas →
                </Link>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-[#10151f]">
                    <tr>
                      <th className={cn(lbl, "px-4 py-2.5 text-left")}>Folio</th>
                      <th className={cn(lbl, "px-4 py-2.5 text-left")}>Fecha</th>
                      <th className={cn(lbl, "px-4 py-2.5 text-left")}>Cliente</th>
                      <th className={cn(lbl, "px-4 py-2.5 text-right")}>Total</th>
                      <th className={cn(lbl, "px-4 py-2.5 text-center")}>Estatus</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04]">
                    {datos.ventasRecientes.map((v) => (
                      <tr key={v.id} className="hover:bg-white/[0.03] transition-colors">
                        <td className="px-4 py-2.5 text-[12px] font-black text-cyan-300">
                          {v.serie}-{v.numVenta}
                        </td>
                        <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400">
                          {fechaCorta(v.fecha)}
                        </td>
                        <td className="px-4 py-2.5 text-[12px] font-bold text-slate-300 max-w-[180px] truncate">
                          {v.cliente}
                        </td>
                        <td className="px-4 py-2.5 text-[12px] font-black text-slate-200 text-right">
                          {moneda(v.total)}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <span
                            className={cn(
                              "text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-lg border",
                              v.estatus === "PAGADA"
                                ? "text-emerald-300 bg-emerald-500/10 border-emerald-500/25"
                                : "text-amber-300 bg-amber-500/10 border-amber-500/25"
                            )}
                          >
                            {v.estatus ?? "—"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Top artículos del mes */}
            <div className="bg-white/[0.04] border border-white/10 rounded-2xl backdrop-blur-xl overflow-hidden">
              <div className="px-4 pt-4 pb-2">
                <p className={lbl}>Artículos más vendidos del mes</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-[#10151f]">
                    <tr>
                      <th className={cn(lbl, "px-4 py-2.5 text-left")}>Código</th>
                      <th className={cn(lbl, "px-4 py-2.5 text-left")}>Descripción</th>
                      <th className={cn(lbl, "px-4 py-2.5 text-right")}>Piezas</th>
                      <th className={cn(lbl, "px-4 py-2.5 text-right")}>Importe</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04]">
                    {datos.topArticulos.map((a) => (
                      <tr key={a.codigo} className="hover:bg-white/[0.03] transition-colors">
                        <td className="px-4 py-2.5 text-[12px] font-black text-amber-300">
                          {a.codigo}
                        </td>
                        <td className="px-4 py-2.5 text-[12px] font-bold text-slate-300 max-w-[220px] truncate">
                          {a.descripcion}
                        </td>
                        <td className="px-4 py-2.5 text-[12px] font-black text-slate-200 text-right">
                          {entero(a.piezas)}
                        </td>
                        <td className="px-4 py-2.5 text-[12px] font-black text-slate-200 text-right">
                          {moneda(a.importe)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
