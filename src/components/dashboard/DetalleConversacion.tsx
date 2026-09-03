"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ChevronLeft, ChevronRight, Globe, Loader2, MessageCircle, Store, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { entero, fechaCorta } from "@/lib/formato";

// Una conversación del Vendedor IA vista como chat (burbujas), con visor de
// fotos. Se abre desde la bitácora; es autónomo: carga su detalle, maneja Esc
// y las flechas del visor, y avisa al cerrar.

export interface ConversacionResumen {
  id: number;
  telefono: string;
  /** Nombre en el padrón de clientes con descuento; null = sin dar de alta. */
  cliente: string | null;
  idCliente: number | null;
  fecha: string;
  canal: string;
  mensajes: number;
  iniciadaEn: string;
  ultimaEn: string;
  primerMensaje: string | null;
}

interface MensajeGuardado {
  id: number;
  rol: "cliente" | "vendedor";
  mensaje: string;
  fotos: string[];
  creadoEn: string;
}

interface Detalle {
  conversacion: ConversacionResumen;
  mensajes: MensajeGuardado[];
}

/** "2026-08-19 14:03:22" → "14:03". */
export const hora = (momento: string) => momento.slice(11, 16);

/** El chat web usa una sesión sintética 77…, no un teléfono marcable. */
export const esVisitaWeb = (c: ConversacionResumen) => c.canal === "web";

/**
 * Quién escribe. Si el celular está dado de alta en Clientes con descuento se
 * muestra el nombre y el teléfono entre paréntesis; si no, el teléfono y la
 * aclaración de que no está dado de alta. El chat web no tiene teléfono.
 */
export function Contacto({ c }: { c: ConversacionResumen }) {
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

const ESTILO_CANAL: Record<string, { etiqueta: string; clase: string; Icono: typeof Globe }> = {
  web: { etiqueta: "Chat web", clase: "text-cyan-300 bg-cyan-500/10 border-cyan-500/25", Icono: Globe },
  whatsapp: {
    etiqueta: "WhatsApp",
    clase: "text-emerald-300 bg-emerald-500/10 border-emerald-500/25",
    Icono: MessageCircle,
  },
  // Vico en modo vendedor desde /mostrador de vidaurri-page: neutro, para que
  // no se confunda con un chat de cliente por WhatsApp.
  mostrador: { etiqueta: "Mostrador", clase: "text-slate-300 bg-white/[0.06] border-white/15", Icono: Store },
};

export function BadgeCanal({ canal }: { canal: string }) {
  const { etiqueta, clase, Icono } = ESTILO_CANAL[canal] ?? ESTILO_CANAL.whatsapp;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-lg border",
        clase
      )}
    >
      <Icono className="h-3 w-3" />
      {etiqueta}
    </span>
  );
}

/** Miniatura de una foto enviada: el clic la abre AMPLIADA en el visor. Las
 *  URLs guardadas apuntan al servidor que respondió en su momento: si la foto
 *  ya no carga (otro entorno, marca vieja), el recuadro vacío se cambia por un
 *  enlace legible — ahí el visor no tendría nada que mostrar. */
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

const btnVisor =
  "p-2.5 rounded-xl bg-white/[0.08] border border-white/10 text-slate-200 hover:text-amber-300 transition-all";

interface Props {
  id: number;
  /** Debe ser estable (useCallback): se usa en el manejador de teclado. */
  onCerrar: () => void;
}

export function DetalleConversacion({ id, onCerrar }: Props) {
  const router = useRouter();
  const [detalle, setDetalle] = useState<Detalle | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  /** Índice (sobre todas las fotos de la conversación) de la foto ampliada. */
  const [fotoIdx, setFotoIdx] = useState<number | null>(null);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const res = await fetch(`/api/conversaciones/${id}`);
        if (res.status === 401) {
          router.push("/login");
          return;
        }
        const cuerpo = (await res.json().catch(() => null)) as (Detalle & { error?: string }) | null;
        if (!res.ok || !cuerpo || cuerpo.error) {
          throw new Error(cuerpo?.error ?? "No se pudo leer la conversación");
        }
        if (!cancelado) setDetalle(cuerpo);
      } catch (err: unknown) {
        if (!cancelado) setError(err instanceof Error ? err.message : "Error al leer");
      } finally {
        if (!cancelado) setCargando(false);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [id, router]);

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
  const totalFotos = fotosPlanas.length;

  // Esc cierra lo de más arriba primero (visor, luego el chat), como cualquier
  // pila de overlays; las flechas navegan el visor.
  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (fotoIdx != null) setFotoIdx(null);
        else onCerrar();
        return;
      }
      if (fotoIdx == null || totalFotos < 2) return;
      if (e.key === "ArrowRight") {
        setFotoIdx((i) => (i == null ? i : (i + 1) % totalFotos));
      } else if (e.key === "ArrowLeft") {
        setFotoIdx((i) => (i == null ? i : (i - 1 + totalFotos) % totalFotos));
      }
    };
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, [fotoIdx, totalFotos, onCerrar]);

  return (
    <>
      <div
        className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-6"
        onClick={onCerrar}
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
              onClick={onCerrar}
              aria-label="Cerrar"
              className="ml-auto p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/[0.06] transition-all"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Mensajes */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            {cargando ? (
              <div className="flex items-center justify-center gap-2 p-8 text-slate-400 text-sm font-bold">
                <Loader2 className="h-4 w-4 animate-spin" />
                Cargando conversación…
              </div>
            ) : error ? (
              <div className="flex items-center gap-2 bg-rose-500/10 border border-rose-500/25 rounded-xl p-4 text-rose-300 text-sm font-bold">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {error}
              </div>
            ) : (
              detalle?.mensajes.map((m, idxMensaje) => (
                <div
                  key={m.id}
                  className={cn("flex", m.rol === "vendedor" ? "justify-end" : "justify-start")}
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
                            onAmpliar={() => setFotoIdx(offsetsFotos[idxMensaje] + i)}
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

      {/* Visor: la foto en grande, por encima del chat */}
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
          <div onClick={(e) => e.stopPropagation()} className="mt-3 flex items-center gap-2">
            {totalFotos > 1 && (
              <>
                <button
                  onClick={() => setFotoIdx((i) => (i == null ? i : (i - 1 + totalFotos) % totalFotos))}
                  aria-label="Foto anterior"
                  className={btnVisor}
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="px-2 text-[11px] font-black text-slate-400 tabular-nums">
                  {entero(fotoIdx + 1)} / {entero(totalFotos)}
                </span>
                <button
                  onClick={() => setFotoIdx((i) => (i == null ? i : (i + 1) % totalFotos))}
                  aria-label="Foto siguiente"
                  className={btnVisor}
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </>
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
    </>
  );
}
