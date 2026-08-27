"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Globe,
  Loader2,
  MessageCircle,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { entero, fechaCorta, hoyISO } from "@/lib/formato";

// Historial de conversaciones del Vendedor IA (WhatsApp + chat de la página).
// Lista por conversación (teléfono + día) y detalle en burbujas, como se vería
// el chat. Detrás del login del panel: aquí hay teléfonos reales de clientes.

interface ConversacionResumen {
  id: number;
  telefono: string;
  /** Nombre en el padrón de clientes con descuento; null = sin dar de alta. */
  cliente: string | null;
  fecha: string;
  canal: string;
  mensajes: number;
  iniciadaEn: string;
  ultimaEn: string;
  primerMensaje: string | null;
}

interface PaginaConversaciones {
  conversaciones: ConversacionResumen[];
  total: number;
  totalMensajes: number;
  porCanal: { whatsapp: number; web: number };
  porPagina: number;
}

interface MensajeGuardado {
  id: number;
  rol: "cliente" | "vendedor";
  mensaje: string;
  fotos: string[];
  creadoEn: string;
}

interface DetalleConversacion {
  conversacion: ConversacionResumen;
  mensajes: MensajeGuardado[];
}

const lbl = "text-[10px] font-black text-slate-500 uppercase tracking-widest";
const inputCls =
  "block w-full px-4 py-2.5 bg-white/[0.03] border border-white/10 rounded-xl text-sm font-bold text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-400/25 focus:border-amber-400/60 transition-all";

const diasAtras = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString("sv-SE");
};

/** "2026-08-19 14:03:22" → "14:03". La fecha va aparte en la lista. */
const hora = (momento: string) => momento.slice(11, 16);

/** El chat web usa una sesión sintética 77…, no un teléfono marcable. */
const esVisitaWeb = (c: ConversacionResumen) => c.canal === "web";

/**
 * Quién escribe. Si el celular está dado de alta en Clientes con descuento se
 * muestra el nombre y el teléfono entre paréntesis; si no, el teléfono y la
 * aclaración de que no está dado de alta. El chat web no tiene teléfono.
 */
function Contacto({ c }: { c: ConversacionResumen }) {
  if (esVisitaWeb(c)) {
    return (
      <span className="font-mono text-sm font-bold text-slate-100 tabular-nums">
        Visitante web #{String(c.id).padStart(4, "0")}
      </span>
    );
  }
  if (c.cliente) {
    return (
      <span className="min-w-0">
        <span className="text-sm font-black text-slate-100">{c.cliente}</span>{" "}
        <span className="font-mono text-[12px] font-bold text-slate-400 tabular-nums">
          ({c.telefono})
        </span>
      </span>
    );
  }
  return (
    <span className="min-w-0">
      <span className="font-mono text-sm font-bold text-slate-100 tabular-nums">{c.telefono}</span>{" "}
      <span className="text-[11px] font-bold text-amber-300/80">(Cliente sin dar de alta)</span>
    </span>
  );
}

/** Miniatura de una foto enviada: el clic la abre AMPLIADA en el visor de la
 *  página. Las URLs guardadas apuntan al servidor que respondió en su momento:
 *  si la foto ya no carga (otro entorno, marca vieja), el recuadro vacío se
 *  cambia por un enlace legible — ahí el visor no tendría nada que mostrar. */
function FotoMensaje({ url, onAmpliar }: { url: string; onAmpliar: () => void }) {
  const [rota, setRota] = useState(false);
  if (rota) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/[0.05] border border-white/10 text-[11px] font-bold text-slate-300 hover:text-amber-300 transition-colors"
      >
        📷 Ver foto
      </a>
    );
  }
  return (
    <button
      type="button"
      onClick={onAmpliar}
      aria-label="Ver la foto en grande"
      className="block cursor-zoom-in rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400/60"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt="Foto enviada por el vendedor"
        loading="lazy"
        onError={() => setRota(true)}
        className="h-24 w-24 object-cover rounded-lg border border-white/10 transition-transform duration-150 hover:scale-[1.03]"
      />
    </button>
  );
}

function BadgeCanal({ canal }: { canal: string }) {
  const esWeb = canal === "web";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-lg border",
        esWeb
          ? "text-cyan-300 bg-cyan-500/10 border-cyan-500/25"
          : "text-emerald-300 bg-emerald-500/10 border-emerald-500/25"
      )}
    >
      {esWeb ? <Globe className="h-3 w-3" /> : <MessageCircle className="h-3 w-3" />}
      {esWeb ? "Chat web" : "WhatsApp"}
    </span>
  );
}

export default function ConversacionesPage() {
  const [fechaInicio, setFechaInicio] = useState(diasAtras(30));
  const [fechaFin, setFechaFin] = useState(hoyISO());
  const [busqueda, setBusqueda] = useState("");
  const [canal, setCanal] = useState<"" | "whatsapp" | "web">("");
  const [pagina, setPagina] = useState(1);

  const [datos, setDatos] = useState<PaginaConversaciones | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  const [abierta, setAbierta] = useState<number | null>(null);
  const [detalle, setDetalle] = useState<DetalleConversacion | null>(null);
  /** Índice (sobre todas las fotos de la conversación) de la foto ampliada. */
  const [fotoIdx, setFotoIdx] = useState<number | null>(null);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);
  const [errorDetalle, setErrorDetalle] = useState("");

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      const parametros = new URLSearchParams({
        desde: fechaInicio,
        hasta: fechaFin,
        pagina: String(pagina),
      });
      if (busqueda.trim()) parametros.set("busqueda", busqueda.trim());
      if (canal) parametros.set("canal", canal);

      const res = await fetch(`/api/conversaciones?${parametros}`);
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      const cuerpo = (await res.json().catch(() => null)) as
        | (PaginaConversaciones & { error?: string })
        | null;
      if (!res.ok || !cuerpo || cuerpo.error) {
        throw new Error(cuerpo?.error ?? "No se pudo consultar la bitácora");
      }
      setDatos(cuerpo);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error al consultar");
      setDatos(null);
    } finally {
      setCargando(false);
    }
  }, [fechaInicio, fechaFin, busqueda, canal, pagina]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // Detalle de la conversación abierta.
  useEffect(() => {
    setFotoIdx(null); // el visor pertenece a la conversación que se estaba viendo
    if (abierta == null) {
      setDetalle(null);
      return;
    }
    let cancelado = false;
    setCargandoDetalle(true);
    setErrorDetalle("");
    (async () => {
      try {
        const res = await fetch(`/api/conversaciones/${abierta}`);
        if (res.status === 401) {
          window.location.href = "/login";
          return;
        }
        const cuerpo = (await res.json().catch(() => null)) as
          | (DetalleConversacion & { error?: string })
          | null;
        if (!res.ok || !cuerpo || cuerpo.error) {
          throw new Error(cuerpo?.error ?? "No se pudo leer la conversación");
        }
        if (!cancelado) setDetalle(cuerpo);
      } catch (err: unknown) {
        if (!cancelado) {
          setErrorDetalle(err instanceof Error ? err.message : "Error al leer");
        }
      } finally {
        if (!cancelado) setCargandoDetalle(false);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [abierta]);

  // Todas las fotos de la conversación en plano, y el offset de cada mensaje
  // dentro de esa lista: así el visor puede pasar de una foto a la siguiente
  // aunque vengan de mensajes distintos.
  const fotosPlanas = detalle?.mensajes.flatMap((m) => m.fotos) ?? [];
  const offsetsFotos: number[] = [];
  {
    let acumulado = 0;
    for (const m of detalle?.mensajes ?? []) {
      offsetsFotos.push(acumulado);
      acumulado += m.fotos.length;
    }
  }

  // Esc cierra lo de más arriba primero (visor, luego detalle), como cualquier
  // pila de overlays; las flechas navegan el visor.
  useEffect(() => {
    if (abierta == null) return;
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (fotoIdx != null) setFotoIdx(null);
        else setAbierta(null);
        return;
      }
      if (fotoIdx == null || fotosPlanas.length < 2) return;
      if (e.key === "ArrowRight") {
        setFotoIdx((i) => (i == null ? i : (i + 1) % fotosPlanas.length));
      } else if (e.key === "ArrowLeft") {
        setFotoIdx((i) =>
          i == null ? i : (i - 1 + fotosPlanas.length) % fotosPlanas.length
        );
      }
    };
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, [abierta, fotoIdx, fotosPlanas.length]);

  const totalPaginas = datos
    ? Math.max(1, Math.ceil(datos.total / datos.porPagina))
    : 1;

  const tarjetas = datos
    ? [
        { titulo: "Conversaciones", valor: entero(datos.total), color: "text-slate-200" },
        { titulo: "Mensajes", valor: entero(datos.totalMensajes), color: "text-amber-300" },
        { titulo: "WhatsApp", valor: entero(datos.porCanal.whatsapp), color: "text-emerald-300" },
        { titulo: "Chat web", valor: entero(datos.porCanal.web), color: "text-cyan-300" },
      ]
    : [];

  return (
    <div className="space-y-4">
      {/* Encabezado */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight">
            Conversaciones del Vendedor IA
          </h1>
          <p className={cn(lbl, "mt-1")}>
            {cargando
              ? "Consultando..."
              : datos
                ? `${entero(datos.total)} conversaciones en el rango`
                : "Sin datos"}
          </p>
        </div>
        <button
          onClick={() => void cargar()}
          disabled={cargando}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/[0.05] border border-white/10 text-slate-300 text-[11px] font-black uppercase tracking-widest hover:text-amber-300 transition-all disabled:opacity-40"
        >
          {cargando ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Actualizar
        </button>
      </div>

      {/* Filtros */}
      <div className="bg-white/[0.02] border border-white/10 rounded-2xl p-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className={lbl}>Desde</label>
            <input
              type="date"
              value={fechaInicio}
              onChange={(e) => {
                setFechaInicio(e.target.value);
                setPagina(1);
              }}
              className={cn(inputCls, "mt-1")}
            />
          </div>
          <div>
            <label className={lbl}>Hasta</label>
            <input
              type="date"
              value={fechaFin}
              onChange={(e) => {
                setFechaFin(e.target.value);
                setPagina(1);
              }}
              className={cn(inputCls, "mt-1")}
            />
          </div>
          <div>
            <label className={lbl}>Teléfono o cliente</label>
            <div className="relative mt-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-600" />
              <input
                type="search"
                value={busqueda}
                onChange={(e) => {
                  setBusqueda(e.target.value);
                  setPagina(1);
                }}
                placeholder="Número o nombre del cliente…"
                className={cn(inputCls, "pl-9")}
              />
            </div>
          </div>
          <div>
            <label className={lbl}>Canal</label>
            <select
              value={canal}
              onChange={(e) => {
                setCanal(e.target.value as "" | "whatsapp" | "web");
                setPagina(1);
              }}
              className={cn(inputCls, "mt-1 appearance-none [color-scheme:dark]")}
            >
              <option value="" className="bg-[#0d1320] text-slate-100">
                Todos
              </option>
              <option value="whatsapp" className="bg-[#0d1320] text-slate-100">
                WhatsApp
              </option>
              <option value="web" className="bg-[#0d1320] text-slate-100">
                Chat web
              </option>
            </select>
          </div>
        </div>
      </div>

      {/* Tarjetas de totales */}
      {datos && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {tarjetas.map((t) => (
            <div
              key={t.titulo}
              className="bg-white/[0.02] border border-white/10 rounded-2xl p-4"
            >
              <p className={lbl}>{t.titulo}</p>
              <p className={cn("text-2xl font-black mt-1 tabular-nums", t.color)}>
                {t.valor}
              </p>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 bg-rose-500/10 border border-rose-500/25 rounded-2xl p-4 text-rose-300 text-sm font-bold">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Lista */}
      <div className="bg-white/[0.02] border border-white/10 rounded-2xl overflow-hidden">
        {cargando ? (
          <div className="flex items-center justify-center gap-2 p-10 text-slate-400 text-sm font-bold">
            <Loader2 className="h-4 w-4 animate-spin" />
            Consultando la bitácora…
          </div>
        ) : !datos || datos.conversaciones.length === 0 ? (
          <div className="p-10 text-center text-slate-500 text-sm font-bold">
            No hay conversaciones en el rango seleccionado.
          </div>
        ) : (
          <ul className="divide-y divide-white/[0.06]">
            {datos.conversaciones.map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => setAbierta(c.id)}
                  className="w-full text-left px-4 py-3.5 hover:bg-white/[0.03] transition-colors"
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Contacto c={c} />
                    <BadgeCanal canal={c.canal} />
                    <span className="text-[11px] font-bold text-slate-500 tabular-nums">
                      {fechaCorta(c.fecha)} · {hora(c.iniciadaEn)}–{hora(c.ultimaEn)}
                    </span>
                    <span className="ml-auto text-[11px] font-black text-slate-400 tabular-nums">
                      {entero(c.mensajes)} msjs
                    </span>
                  </div>
                  {c.primerMensaje && (
                    <p className="mt-1 text-[13px] text-slate-400 truncate">
                      “{c.primerMensaje}”
                    </p>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Paginación */}
      {datos && totalPaginas > 1 && (
        <div className="flex items-center justify-between">
          <button
            onClick={() => setPagina((p) => Math.max(1, p - 1))}
            disabled={pagina <= 1 || cargando}
            className="flex items-center gap-1 px-4 py-2 rounded-xl bg-white/[0.05] border border-white/10 text-slate-300 text-[11px] font-black uppercase tracking-widest hover:text-amber-300 transition-all disabled:opacity-40"
          >
            <ChevronLeft className="h-3.5 w-3.5" /> Anterior
          </button>
          <span className={lbl}>
            Página {entero(pagina)} de {entero(totalPaginas)}
          </span>
          <button
            onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
            disabled={pagina >= totalPaginas || cargando}
            className="flex items-center gap-1 px-4 py-2 rounded-xl bg-white/[0.05] border border-white/10 text-slate-300 text-[11px] font-black uppercase tracking-widest hover:text-amber-300 transition-all disabled:opacity-40"
          >
            Siguiente <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Detalle: la conversación como chat */}
      {abierta != null && (
        <div
          className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-6"
          onClick={() => setAbierta(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Detalle de la conversación"
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-2xl max-h-[92vh] sm:max-h-[85vh] flex flex-col bg-[#0a101c] border border-white/10 sm:rounded-2xl rounded-t-2xl shadow-2xl shadow-black/60"
          >
            {/* Encabezado del chat */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10">
              {detalle ? (
                <>
                  <div className="min-w-0">
                    <p className="truncate">
                      <Contacto c={detalle.conversacion} />
                    </p>
                    <p className="text-[11px] font-bold text-slate-500 tabular-nums">
                      {fechaCorta(detalle.conversacion.fecha)} ·{" "}
                      {entero(detalle.conversacion.mensajes)} mensajes
                    </p>
                  </div>
                  <BadgeCanal canal={detalle.conversacion.canal} />
                </>
              ) : (
                <p className="text-sm font-bold text-slate-400">Conversación</p>
              )}
              <button
                onClick={() => setAbierta(null)}
                aria-label="Cerrar"
                className="ml-auto p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/[0.06] transition-all"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Mensajes */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              {cargandoDetalle ? (
                <div className="flex items-center justify-center gap-2 p-8 text-slate-400 text-sm font-bold">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Cargando conversación…
                </div>
              ) : errorDetalle ? (
                <div className="flex items-center gap-2 bg-rose-500/10 border border-rose-500/25 rounded-xl p-4 text-rose-300 text-sm font-bold">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  {errorDetalle}
                </div>
              ) : (
                detalle?.mensajes.map((m, idxMensaje) => (
                  <div
                    key={m.id}
                    className={cn(
                      "flex",
                      m.rol === "vendedor" ? "justify-end" : "justify-start"
                    )}
                  >
                    <div
                      className={cn(
                        "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-relaxed",
                        m.rol === "vendedor"
                          ? "bg-amber-400/10 border border-amber-400/20 text-amber-50 rounded-br-md"
                          : "bg-white/[0.05] border border-white/10 text-slate-200 rounded-bl-md"
                      )}
                    >
                      <p className="whitespace-pre-wrap break-words">{m.mensaje}</p>
                      {m.fotos.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {m.fotos.map((url, i) => (
                            <FotoMensaje
                              key={`${m.id}-${i}`}
                              url={url}
                              onAmpliar={() =>
                                setFotoIdx(offsetsFotos[idxMensaje] + i)
                              }
                            />
                          ))}
                        </div>
                      )}
                      <p
                        className={cn(
                          "mt-1 text-[10px] font-bold tabular-nums",
                          m.rol === "vendedor" ? "text-amber-200/40" : "text-slate-500"
                        )}
                      >
                        {m.rol === "vendedor" ? "Vico" : "Cliente"} · {hora(m.creadoEn)}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Visor: la foto en grande, por encima del detalle */}
      {fotoIdx != null && fotosPlanas[fotoIdx] && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Foto ampliada"
          className="fixed inset-0 z-[90] flex flex-col items-center justify-center bg-black/90 backdrop-blur-sm p-4"
          onClick={() => setFotoIdx(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={fotosPlanas[fotoIdx]}
            alt="Foto enviada por el vendedor, ampliada"
            onClick={(e) => e.stopPropagation()}
            className="max-h-[82vh] max-w-[94vw] object-contain rounded-xl border border-white/10 shadow-2xl shadow-black/60"
          />

          <div
            onClick={(e) => e.stopPropagation()}
            className="mt-3 flex items-center gap-2"
          >
            {fotosPlanas.length > 1 && (
              <button
                onClick={() =>
                  setFotoIdx((i) =>
                    i == null ? i : (i - 1 + fotosPlanas.length) % fotosPlanas.length
                  )
                }
                aria-label="Foto anterior"
                className="p-2.5 rounded-xl bg-white/[0.08] border border-white/10 text-slate-200 hover:text-amber-300 transition-all"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}
            {fotosPlanas.length > 1 && (
              <span className="px-2 text-[11px] font-black text-slate-400 tabular-nums">
                {entero(fotoIdx + 1)} / {entero(fotosPlanas.length)}
              </span>
            )}
            {fotosPlanas.length > 1 && (
              <button
                onClick={() =>
                  setFotoIdx((i) => (i == null ? i : (i + 1) % fotosPlanas.length))
                }
                aria-label="Foto siguiente"
                className="p-2.5 rounded-xl bg-white/[0.08] border border-white/10 text-slate-200 hover:text-amber-300 transition-all"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            )}
            <a
              href={fotosPlanas[fotoIdx]}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3.5 py-2.5 rounded-xl bg-white/[0.08] border border-white/10 text-[11px] font-black uppercase tracking-widest text-slate-200 hover:text-amber-300 transition-all"
            >
              Abrir original
            </a>
            <button
              onClick={() => setFotoIdx(null)}
              aria-label="Cerrar la foto"
              className="p-2.5 rounded-xl bg-white/[0.08] border border-white/10 text-slate-200 hover:text-white transition-all"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
