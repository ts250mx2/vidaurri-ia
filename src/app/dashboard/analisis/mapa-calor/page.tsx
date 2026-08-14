"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Flame, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { moneda, entero } from "@/lib/formato";
import {
  SelectorSucursal,
  SUCURSALES,
  type Sucursal,
} from "@/components/dashboard/SelectorSucursal";

// Mapa de calor de ventas. Las ventas no tienen hora (fecha DATE), así que la
// vista clásica día × hora se sustituye por dos matrices: día de la semana ×
// últimos 12 meses y día de la semana × últimas 16 semanas. Cada celda trae
// importe y número de ventas; el alternador de métrica es 100% en cliente.

// ---------- Tipos (espejo de /api/analisis/mapa-calor) ----------
interface Celda {
  ventas: number;
  importe: number;
}

interface MatrizCalor {
  columnas: string[];
  /** celdas[dia][columna], dia 0=Lun..6=Dom (WEEKDAY de MySQL). */
  celdas: Celda[][];
  totalesFila: Celda[];
  totalesColumna: Celda[];
  max: Celda;
}

interface DatosMapaCalor {
  sucursal: string;
  desde: string;
  porMes: MatrizCalor;
  porSemana: MatrizCalor;
  total: Celda;
}

type Metrica = "importe" | "ventas";

// ---------- Constantes de estilo (lenguaje visual de vidaurri-ia) ----------
const lbl = "text-[10px] font-black text-slate-500 uppercase tracking-widest";

const DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const DIAS_LARGOS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const MESES_CORTOS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

const METRICAS: { valor: Metrica; etiqueta: string }[] = [
  { valor: "importe", etiqueta: "Importe" },
  { valor: "ventas", etiqueta: "Núm. ventas" },
];

// Color base de la escala: amber-500 (rgb 245,158,11). La intensidad de cada
// celda se calcula en JS y se aplica con style inline porque Tailwind no puede
// generar clases con opacidad dinámica por celda.
const AMBER_RGB = "245,158,11";
const ALFA_MIN = 0.08;
const ALFA_MAX = 0.85;
// A partir de esta proporción del máximo el fondo ámbar es tan brillante que el
// texto legible es el oscuro: punto donde el texto oscuro supera 4.5:1 de
// contraste WCAG con esta escala de alfa.
const UMBRAL_TEXTO_OSCURO = 0.72;

/** 'AAAA-MM' → 'Sep 25'. */
function etiquetaMes(mes: string): string {
  const [a, m] = mes.split("-");
  const nombre = MESES_CORTOS[Number(m) - 1] ?? mes;
  return `${nombre} ${a?.slice(2) ?? ""}`;
}

/** 'AAAA-MM-DD' (lunes de la semana) → 'DD/MM'. */
function etiquetaSemana(lunes: string): string {
  const [, m, d] = lunes.split("-");
  return `${d}/${m}`;
}

/** Valor compacto para caber dentro de la celda; el detalle va en el title. */
function compacto(valor: number, metrica: Metrica): string {
  if (metrica === "ventas") return entero(valor);
  if (valor >= 1_000_000) return `$${(valor / 1_000_000).toFixed(1)}M`;
  if (valor >= 10_000) return `$${Math.round(valor / 1_000)}k`;
  if (valor >= 1_000) return `$${(valor / 1_000).toFixed(1)}k`;
  return `$${Math.round(valor)}`;
}

function formatoMetrica(celda: Celda, metrica: Metrica): string {
  return metrica === "importe" ? moneda(celda.importe) : entero(celda.ventas);
}

function CeldaCalor({
  celda,
  ratio,
  titulo,
  metrica,
}: {
  celda: Celda;
  ratio: number;
  titulo: string;
  metrica: Metrica;
}) {
  const valor = celda[metrica];
  if (valor <= 0) {
    return (
      <td
        title={titulo}
        className="h-9 min-w-[58px] rounded-lg bg-white/[0.02] text-center text-[10px] font-bold text-slate-700"
      >
        ·
      </td>
    );
  }
  const alfa = ALFA_MIN + (ALFA_MAX - ALFA_MIN) * ratio;
  return (
    <td
      title={titulo}
      className={cn(
        "h-9 min-w-[58px] rounded-lg text-center text-[10px] font-black transition-colors",
        ratio >= UMBRAL_TEXTO_OSCURO ? "text-slate-950" : "text-amber-100"
      )}
      style={{ backgroundColor: `rgba(${AMBER_RGB},${alfa.toFixed(3)})` }}
    >
      {compacto(valor, metrica)}
    </td>
  );
}

function TablaCalor({
  titulo,
  subtitulo,
  matriz,
  metrica,
  etiquetaColumna,
  tituloColumna,
}: {
  titulo: string;
  subtitulo: string;
  matriz: MatrizCalor;
  metrica: Metrica;
  etiquetaColumna: (col: string) => string;
  tituloColumna: (col: string) => string;
}) {
  const max = Math.max(1, matriz.max[metrica]);
  return (
    <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-4 backdrop-blur-xl">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <p className={lbl}>{titulo}</p>
        <p className="text-[10px] font-bold text-slate-600">{subtitulo}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-1">
          <thead>
            <tr>
              <th className={cn(lbl, "px-2 text-left")}>Día</th>
              {matriz.columnas.map((col) => (
                <th key={col} title={tituloColumna(col)} className={cn(lbl, "px-1 text-center")}>
                  {etiquetaColumna(col)}
                </th>
              ))}
              <th className={cn(lbl, "px-2 text-right")}>Total</th>
            </tr>
          </thead>
          <tbody>
            {DIAS.map((dia, i) => (
              <tr key={dia}>
                <td className="pr-2 text-[11px] font-black text-slate-400 uppercase whitespace-nowrap">
                  {dia}
                </td>
                {matriz.columnas.map((col, j) => {
                  const celda = matriz.celdas[i][j];
                  return (
                    <CeldaCalor
                      key={col}
                      celda={celda}
                      ratio={celda[metrica] / max}
                      metrica={metrica}
                      titulo={`${DIAS_LARGOS[i]} · ${tituloColumna(col)}: ${moneda(celda.importe)} · ${entero(celda.ventas)} ventas`}
                    />
                  );
                })}
                <td
                  title={`Total ${DIAS_LARGOS[i]}: ${moneda(matriz.totalesFila[i].importe)} · ${entero(matriz.totalesFila[i].ventas)} ventas`}
                  className="pl-2 text-[11px] font-black text-amber-300 text-right whitespace-nowrap"
                >
                  {compacto(matriz.totalesFila[i][metrica], metrica)}
                </td>
              </tr>
            ))}
            {/* Totales por columna */}
            <tr>
              <td className={cn(lbl, "pr-2 text-left")}>Total</td>
              {matriz.columnas.map((col, j) => (
                <td
                  key={col}
                  title={`Total ${tituloColumna(col)}: ${moneda(matriz.totalesColumna[j].importe)} · ${entero(matriz.totalesColumna[j].ventas)} ventas`}
                  className="h-8 rounded-lg bg-[#10151f] text-center text-[10px] font-black text-slate-300"
                >
                  {matriz.totalesColumna[j][metrica] > 0
                    ? compacto(matriz.totalesColumna[j][metrica], metrica)
                    : "·"}
                </td>
              ))}
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      {/* Leyenda de escala */}
      <div className="flex flex-wrap items-center justify-end gap-2 mt-3">
        <span className={lbl}>Intensidad</span>
        <span className="text-[9px] font-bold text-slate-500">Menor</span>
        <div className="flex items-center gap-1">
          <div className="w-5 h-5 rounded-md bg-white/[0.02]" />
          {[0.1, 0.28, 0.47, 0.66, ALFA_MAX].map((alfa) => (
            <div
              key={alfa}
              className="w-5 h-5 rounded-md"
              style={{ backgroundColor: `rgba(${AMBER_RGB},${alfa})` }}
            />
          ))}
        </div>
        <span className="text-[9px] font-bold text-slate-500">Mayor</span>
        <span className="text-[9px] font-bold text-slate-500 ml-2">
          Máx: {formatoMetrica(matriz.max, metrica)}
        </span>
      </div>
    </div>
  );
}

export default function MapaCalorPage() {
  const [sucursal, setSucursal] = useState<Sucursal>("matriz");
  const [metrica, setMetrica] = useState<Metrica>("importe");
  const [datos, setDatos] = useState<DatosMapaCalor | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  // Token de secuencia: descarta respuestas viejas al cambiar de sucursal.
  const secuenciaRef = useRef(0);

  const cargar = useCallback(async (suc: Sucursal) => {
    const secuencia = ++secuenciaRef.current;
    setCargando(true);
    setError("");
    try {
      const qs = suc === "usadas" ? "?sucursal=usadas" : "";
      const res = await fetch(`/api/analisis/mapa-calor${qs}`);
      if (secuencia !== secuenciaRef.current) return;
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      const json = await res.json();
      if (secuencia !== secuenciaRef.current) return;
      if (!res.ok) throw new Error(json.error || "Error al consultar el mapa de calor");
      setDatos(json);
    } catch (err: unknown) {
      if (secuencia !== secuenciaRef.current) return;
      setError(err instanceof Error ? err.message : "Error desconocido");
      setDatos(null);
    } finally {
      if (secuencia === secuenciaRef.current) setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar(sucursal);
  }, [cargar, sucursal]);

  const cambiarSucursal = useCallback((s: Sucursal) => {
    setError("");
    setSucursal(s);
  }, []);

  return (
    <div className="space-y-4">
      {/* Encabezado */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight flex items-center gap-2">
            <Flame className="h-6 w-6 text-amber-400" /> Mapa de Calor
          </h1>
          <p className={cn(lbl, "mt-1")}>
            {cargando
              ? "Consultando..."
              : datos
                ? `${entero(datos.total.ventas)} ventas · ${moneda(datos.total.importe)} en los últimos 12 meses`
                : "Intensidad de ventas por día de la semana"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/* Alternador de métrica (solo cliente: las celdas traen ambas) */}
          <div className="inline-flex items-center gap-1 p-1 bg-white/[0.04] border border-white/10 rounded-xl">
            {METRICAS.map((m) => (
              <button
                key={m.valor}
                onClick={() => setMetrica(m.valor)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-widest transition-colors whitespace-nowrap",
                  metrica === m.valor
                    ? "bg-amber-500/15 text-amber-300 border border-amber-500/30"
                    : "text-slate-400 hover:text-white hover:bg-white/[0.05] border border-transparent"
                )}
              >
                {m.etiqueta}
              </button>
            ))}
          </div>
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

      {/* Error */}
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
          <TablaCalor
            titulo="Día de la semana × mes (últimos 12 meses)"
            subtitulo={`Cada celda acumula todos los ${metrica === "importe" ? "importes" : "tickets"} de ese día en el mes · pasa el cursor para ver el detalle`}
            matriz={datos.porMes}
            metrica={metrica}
            etiquetaColumna={etiquetaMes}
            tituloColumna={(col) => {
              const [a, m] = col.split("-");
              return `${MESES_CORTOS[Number(m) - 1] ?? m} ${a}`;
            }}
          />
          <TablaCalor
            titulo="Calendario semanal (últimas 16 semanas)"
            subtitulo="Cada columna es una semana (etiquetada por su lunes) · cada celda es un día"
            matriz={datos.porSemana}
            metrica={metrica}
            etiquetaColumna={etiquetaSemana}
            tituloColumna={(col) => `semana del ${col.split("-").reverse().join("/")}`}
          />
        </>
      ) : null}
    </div>
  );
}
