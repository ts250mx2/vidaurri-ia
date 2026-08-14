"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { moneda, entero, fechaCorta } from "@/lib/formato";
import {
  SelectorSucursal,
  SUCURSALES,
  type Sucursal,
} from "@/components/dashboard/SelectorSucursal";

// Panel Principal con selector de sucursal: con "Matriz" consume
// /api/dashboard/principal (bdav) y con "Bodega Usado" consume
// /api/usadas/resumen (base remota de piezas usadas, independiente de bdav).

interface MesVentas {
  mes: string;
  ventas: number;
  total: number;
}

interface DatosPrincipal {
  hoy: { ventasHoy: number; totalHoy: number; cotizacionesHoy: number };
  meses: MesVentas[];
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

interface DatosUsadas {
  hoy: { ventasHoy: number; totalHoy: number };
  meses: MesVentas[];
  inventario: { piezasConExistencia: number; valorInventario: number };
  porCobrar: { ventasConSaldo: number; porCobrar: number };
  ventasRecientes: {
    id: number;
    numVenta: number;
    fecha: string;
    total: number;
    saldo: number;
    estatus: string | null;
    cliente: string | null;
  }[];
  topPiezas: { codigo: string; descripcion: string; piezas: number; importe: number }[];
  inventarioPorParte: { parte: string; piezas: number; valor: number }[];
}

interface Tarjeta {
  titulo: string;
  valor: string;
  detalle: string;
  color: string;
}

const lbl = "text-[10px] font-black text-slate-500 uppercase tracking-widest";

const MESES_CORTOS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

function etiquetaMes(mes: string): string {
  const [, m] = mes.split("-");
  return MESES_CORTOS[Number(m) - 1] ?? mes;
}

function TarjetasKpi({ tarjetas, columnas }: { tarjetas: Tarjeta[]; columnas: string }) {
  return (
    <div className={cn("grid grid-cols-2 gap-3", columnas)}>
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
  );
}

// Altura en píxeles de la barra más alta. Se calcula en px (no en %) porque un
// porcentaje dentro de una columna flex sin altura definida no se resuelve y
// todas las barras colapsarían al mínimo.
const ALTO_BARRA_MAX = 150;

function GraficaMeses({ meses }: { meses: MesVentas[] }) {
  const maxMes = Math.max(1, ...meses.map((m) => Number(m.total) || 0));
  return (
    <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-4 backdrop-blur-xl">
      <p className={cn(lbl, "mb-4")}>Ventas de los últimos 12 meses</p>
      <div className="flex items-end gap-2">
        {meses.map((m) => (
          <div key={m.mes} className="flex-1 flex flex-col items-center gap-1 min-w-0 group">
            <span className="text-[9px] font-black text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
              {moneda(m.total)}
            </span>
            <div
              className="w-full rounded-t-lg bg-gradient-to-t from-amber-600/70 to-amber-400/90 hover:from-amber-500 hover:to-orange-400 transition-colors"
              style={{
                height: `${Math.max(3, Math.round(((Number(m.total) || 0) / maxMes) * ALTO_BARRA_MAX))}px`,
              }}
              title={`${m.mes}: ${moneda(m.total)} (${entero(m.ventas)} ventas)`}
            />
            <span className="text-[9px] font-black text-slate-500 uppercase">
              {etiquetaMes(m.mes)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PanelMatriz({ datos }: { datos: DatosPrincipal }) {
  const tarjetas: Tarjeta[] = [
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
  ];

  return (
    <>
      {/* Tarjetas KPI */}
      <TarjetasKpi tarjetas={tarjetas} columnas="lg:grid-cols-5" />

      {/* Gráfica de ventas por mes (12 meses) */}
      <GraficaMeses meses={datos.meses} />

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
  );
}

function PanelUsadas({ datos }: { datos: DatosUsadas }) {
  const mesActual = datos.meses[datos.meses.length - 1];

  const tarjetas: Tarjeta[] = [
    {
      titulo: "Ventas de hoy",
      valor: entero(datos.hoy.ventasHoy),
      detalle: moneda(datos.hoy.totalHoy),
      color: "text-amber-300",
    },
    {
      titulo: "Ventas del mes",
      valor: entero(mesActual?.ventas ?? 0),
      detalle: moneda(mesActual?.total ?? 0),
      color: "text-cyan-300",
    },
    {
      titulo: "Valor de inventario",
      valor: moneda(datos.inventario.valorInventario),
      detalle: `${entero(datos.inventario.piezasConExistencia)} piezas con existencia`,
      color: "text-emerald-300",
    },
    {
      titulo: "Por cobrar",
      valor: moneda(datos.porCobrar.porCobrar),
      detalle: `${entero(datos.porCobrar.ventasConSaldo)} ventas con saldo`,
      color: "text-rose-300",
    },
  ];

  return (
    <>
      {/* Tarjetas KPI */}
      <TarjetasKpi tarjetas={tarjetas} columnas="lg:grid-cols-4" />

      {/* Gráfica de ventas por mes (12 meses) */}
      <GraficaMeses meses={datos.meses} />

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Últimas ventas */}
        <div className="bg-white/[0.04] border border-white/10 rounded-2xl backdrop-blur-xl overflow-hidden">
          <div className="px-4 pt-4 pb-2">
            <p className={lbl}>Últimas ventas</p>
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
                      U-{v.numVenta}
                    </td>
                    <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400">
                      {fechaCorta(v.fecha)}
                    </td>
                    <td className="px-4 py-2.5 text-[12px] font-bold text-slate-300 max-w-[180px] truncate">
                      {v.cliente ?? "Público general"}
                    </td>
                    <td className="px-4 py-2.5 text-[12px] font-black text-slate-200 text-right">
                      {moneda(v.total)}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span
                        className={cn(
                          "text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-lg border",
                          v.estatus === "PAGADO"
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

        {/* Piezas más vendidas del mes */}
        <div className="bg-white/[0.04] border border-white/10 rounded-2xl backdrop-blur-xl overflow-hidden">
          <div className="px-4 pt-4 pb-2">
            <p className={lbl}>Piezas más vendidas del mes</p>
          </div>
          {datos.topPiezas.length === 0 ? (
            <p className="px-4 pb-4 text-[12px] font-bold text-slate-500">
              Sin ventas registradas este mes.
            </p>
          ) : (
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
                  {datos.topPiezas.map((p) => (
                    <tr key={p.codigo} className="hover:bg-white/[0.03] transition-colors">
                      <td className="px-4 py-2.5 text-[12px] font-black text-amber-300 whitespace-nowrap">
                        {p.codigo}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-bold text-slate-300 max-w-[220px] truncate">
                        {p.descripcion}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-black text-slate-200 text-right">
                        {entero(p.piezas)}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-black text-slate-200 text-right">
                        {moneda(p.importe)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Inventario por tipo de parte */}
      <div className="bg-white/[0.04] border border-white/10 rounded-2xl backdrop-blur-xl overflow-hidden">
        <div className="px-4 pt-4 pb-2">
          <p className={lbl}>Inventario por tipo de parte</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-[#10151f]">
              <tr>
                <th className={cn(lbl, "px-4 py-2.5 text-left")}>Tipo de parte</th>
                <th className={cn(lbl, "px-4 py-2.5 text-right")}>Piezas</th>
                <th className={cn(lbl, "px-4 py-2.5 text-right")}>Valor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {datos.inventarioPorParte.map((p) => (
                <tr key={p.parte} className="hover:bg-white/[0.03] transition-colors">
                  <td className="px-4 py-2.5 text-[12px] font-black text-slate-300">
                    {p.parte}
                  </td>
                  <td className="px-4 py-2.5 text-[12px] font-black text-slate-200 text-right">
                    {entero(p.piezas)}
                  </td>
                  <td className="px-4 py-2.5 text-[12px] font-black text-slate-200 text-right">
                    {moneda(p.valor)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

export default function DashboardPrincipal() {
  const [sucursal, setSucursal] = useState<Sucursal>("matriz");
  const [datosMatriz, setDatosMatriz] = useState<DatosPrincipal | null>(null);
  const [datosUsadas, setDatosUsadas] = useState<DatosUsadas | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  // Token de secuencia: descarta respuestas de cargas viejas al cambiar de sucursal.
  const secuenciaRef = useRef(0);

  const cargar = useCallback(async (suc: Sucursal) => {
    const secuencia = ++secuenciaRef.current;
    setCargando(true);
    setError("");
    try {
      const url = suc === "usadas" ? "/api/usadas/resumen" : "/api/dashboard/principal";
      const res = await fetch(url);
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error al consultar el dashboard");
      if (secuencia !== secuenciaRef.current) return;
      if (suc === "usadas") setDatosUsadas(json);
      else setDatosMatriz(json);
    } catch (err: unknown) {
      if (secuencia !== secuenciaRef.current) return;
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      if (secuencia === secuenciaRef.current) setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar(sucursal);
  }, [cargar, sucursal]);

  // El efecto anterior dispara la carga de la sucursal seleccionada.
  const cambiarSucursal = useCallback((s: Sucursal) => {
    setError("");
    setSucursal(s);
  }, []);

  const datosActivos = sucursal === "usadas" ? datosUsadas : datosMatriz;

  return (
    <div className="space-y-4">
      {/* Encabezado */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight">Panel Principal</h1>
          <p className={cn(lbl, "mt-1")}>
            {cargando
              ? "Consultando..."
              : sucursal === "usadas"
                ? "Resumen operativo de la Bodega Usado"
                : "Resumen operativo de Auto Partes Vidaurri"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <SelectorSucursal opciones={SUCURSALES} valor={sucursal} onCambio={cambiarSucursal} />
          <button
            onClick={() => cargar(sucursal)}
            disabled={cargando}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/[0.05] border border-white/10 text-slate-300 text-[11px] font-black uppercase tracking-widest hover:text-amber-300 transition-all disabled:opacity-40"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", cargando && "animate-spin")} /> Actualizar
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-rose-300 text-[11px] font-black bg-rose-500/10 p-3 rounded-xl border border-rose-500/25 uppercase tracking-wider">
          <AlertTriangle className="h-4 w-4" /> {error}
        </div>
      )}

      {cargando && !datosActivos ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 text-amber-400 animate-spin" />
        </div>
      ) : sucursal === "usadas" ? (
        datosUsadas && <PanelUsadas datos={datosUsadas} />
      ) : (
        datosMatriz && <PanelMatriz datos={datosMatriz} />
      )}
    </div>
  );
}
