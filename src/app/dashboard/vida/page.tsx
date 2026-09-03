"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileDown, Loader2, RotateCcw, Send, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { preguntarVida, SesionExpiradaError } from "@/lib/agente-cliente";
import { AgenteMarkdown } from "@/components/dashboard/AgenteMarkdown";
import { MODELOS_VIDA, esModeloVidaValido } from "@/lib/modelos-vida";

interface Mensaje {
  rol: "usuario" | "agente";
  texto: string;
}

const CLAVE_STORAGE = "vida-conversacion";
const CLAVE_MODELO = "vida-modelo";

const SUGERENCIAS = [
  "¿Cómo van las ventas de hoy?",
  "Top 10 artículos más vendidos del mes",
  "¿Qué cofres de Nissan tenemos con existencia?",
  "¿Qué clientes deben más dinero?",
  "¿Qué artículos con venta reciente están agotados?",
  "Compara las ventas de este mes contra el anterior",
  "¿Cómo van las ventas de la Bodega Usado?",
];

export default function VidaPage() {
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [borrador, setBorrador] = useState("");
  const [pregunta, setPregunta] = useState("");
  const [estado, setEstado] = useState("");
  const [pensando, setPensando] = useState(false);
  const [error, setError] = useState("");
  const [modelo, setModelo] = useState(MODELOS_VIDA[0].id);
  /** Índice de la respuesta que se está exportando a PDF. */
  const [exportando, setExportando] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Espejo del texto en curso: el catch de abort lee el acumulado real, no el
  // valor capturado por el closure del render en que se hizo clic.
  const borradorRef = useRef("");
  const finalRef = useRef<HTMLDivElement | null>(null);

  // Restaura la conversación y el modelo elegido.
  useEffect(() => {
    try {
      const guardado = sessionStorage.getItem(CLAVE_STORAGE);
      if (guardado) setMensajes(JSON.parse(guardado));
    } catch {
      // storage corrupto: se inicia limpio
    }
    try {
      const m = localStorage.getItem(CLAVE_MODELO);
      if (m && esModeloVidaValido(m)) setModelo(m);
    } catch {
      // sin localStorage: se queda con el modelo por defecto
    }
  }, []);

  /** PDF de una respuesta junto con la pregunta que la originó (el mensaje anterior). */
  const exportarPdf = async (indice: number) => {
    const respuesta = mensajes[indice];
    const anterior = mensajes[indice - 1];
    if (!respuesta || respuesta.rol !== "agente") return;
    setExportando(indice);
    setError("");
    try {
      const { exportarRespuestaPdf } = await import("@/lib/pdf-respuesta");
      await exportarRespuestaPdf({
        pregunta: anterior?.rol === "usuario" ? anterior.texto : "",
        respuesta: respuesta.texto,
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "No se pudo generar el PDF");
    } finally {
      setExportando(null);
    }
  };

  const cambiarModelo = (id: string) => {
    setModelo(id);
    try {
      localStorage.setItem(CLAVE_MODELO, id);
    } catch {
      // sin localStorage: el cambio vale solo para esta sesión
    }
  };
  useEffect(() => {
    // Con la lista vacía no se escribe: en el primer render (y en la doble
    // corrida de efectos de StrictMode en desarrollo) pisaría con [] la
    // conversación guardada antes de que el efecto de arriba la restaure.
    // "Nueva" borra la clave explícitamente.
    if (mensajes.length === 0) return;
    try {
      sessionStorage.setItem(CLAVE_STORAGE, JSON.stringify(mensajes.slice(-30)));
    } catch {
      // sin espacio: la conversación sigue en memoria
    }
  }, [mensajes]);

  useEffect(() => {
    finalRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [mensajes, borrador, estado]);

  const enviar = useCallback(
    async (texto: string) => {
      const limpia = texto.trim();
      if (!limpia || pensando) return;
      setError("");
      setPregunta("");
      setPensando(true);
      setEstado("");
      setBorrador("");
      borradorRef.current = "";
      const historial = [...mensajes, { rol: "usuario" as const, texto: limpia }];
      setMensajes(historial);

      const controlador = new AbortController();
      abortRef.current = controlador;
      try {
        const respuesta = await preguntarVida(
          limpia,
          historial.slice(0, -1),
          {
            alTexto: (t) => {
              borradorRef.current = t;
              setBorrador(t);
            },
            alEstado: setEstado,
          },
          controlador.signal,
          modelo
        );
        setMensajes([...historial, { rol: "agente", texto: respuesta || "…" }]);
      } catch (err: unknown) {
        if (err instanceof SesionExpiradaError) {
          window.location.href = "/login";
          return;
        }
        if (controlador.signal.aborted) {
          // detenida por el usuario: conserva lo que alcanzó a responder
          const parcial = borradorRef.current;
          setMensajes((previos) =>
            parcial ? [...previos, { rol: "agente", texto: parcial }] : previos
          );
        } else {
          setError(err instanceof Error ? err.message : "VIDA no pudo responder");
        }
      } finally {
        setPensando(false);
        setBorrador("");
        borradorRef.current = "";
        setEstado("");
        abortRef.current = null;
      }
    },
    [mensajes, pensando, modelo]
  );

  const detener = () => abortRef.current?.abort();

  const reiniciar = () => {
    detener();
    setMensajes([]);
    setError("");
    try {
      sessionStorage.removeItem(CLAVE_STORAGE);
    } catch {
      // sin storage disponible
    }
  };

  const vacia = mensajes.length === 0 && !pensando;

  return (
    <div className="flex flex-col h-[calc(100vh-8.5rem)]">
      {/* Cabecera del agente */}
      <div className="flex items-center justify-between gap-3 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-xl">
            🤖
          </div>
          <div>
            <h1 className="text-xl font-black text-white tracking-tight leading-none">
              VIDA <span className="vda-gradient-text">· Agente IA</span>
            </h1>
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mt-1.5">
              Vidaurri Inteligencia de Datos Automotriz · Consulta la base en tu idioma
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Selector de modelo */}
          <div className="flex items-center gap-1 p-1 rounded-xl bg-white/[0.05] border border-white/10">
            {MODELOS_VIDA.map((m) => (
              <button
                key={m.id}
                onClick={() => cambiarModelo(m.id)}
                disabled={pensando}
                title={`Usar ${m.etiqueta}`}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-50",
                  modelo === m.id
                    ? "bg-amber-500 text-slate-950"
                    : "text-slate-400 hover:text-white"
                )}
              >
                {m.etiqueta}
              </button>
            ))}
          </div>
          <button
            onClick={reiniciar}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/[0.05] border border-white/10 text-slate-400 text-[11px] font-black uppercase tracking-widest hover:text-white transition-all"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Nueva
          </button>
        </div>
      </div>

      {/* Conversación */}
      <div className="flex-1 overflow-y-auto bg-white/[0.03] border border-white/10 rounded-2xl backdrop-blur-xl p-4 space-y-4">
        {vacia ? (
          <div className="h-full flex flex-col items-center justify-center gap-5 text-center px-4">
            <div className="text-5xl">🤖</div>
            <div>
              <p className="text-base font-black text-white">Pregúntame lo que quieras del negocio</p>
              <p className="text-[11px] font-bold text-slate-500 mt-1.5 max-w-md">
                Consulto ventas, inventario, clientes, compras y cotizaciones directamente en la
                base de datos, en tiempo real y solo en modo lectura.
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2 max-w-xl">
              {SUGERENCIAS.map((s) => (
                <button
                  key={s}
                  onClick={() => enviar(s)}
                  className="px-3.5 py-2 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-200 text-[12px] font-bold hover:bg-amber-500/20 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {mensajes.map((m, i) => (
              <div
                key={i}
                className={cn("flex", m.rol === "usuario" ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "max-w-[85%] px-4 py-3 rounded-2xl border",
                    m.rol === "usuario"
                      ? "bg-amber-500/15 border-amber-500/25 rounded-br-md text-[13px] font-bold text-amber-100"
                      : "bg-white/[0.05] border-white/10 rounded-bl-md"
                  )}
                >
                  {m.rol === "usuario" ? (
                    m.texto
                  ) : (
                    <>
                      <AgenteMarkdown texto={m.texto} />
                      <div className="mt-2 flex justify-end">
                        <button
                          onClick={() => void exportarPdf(i)}
                          disabled={exportando !== null}
                          title="Exportar esta respuesta a PDF"
                          aria-label="Exportar esta respuesta a PDF"
                          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-transparent text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-amber-300 hover:bg-white/[0.06] hover:border-white/10 transition-colors disabled:opacity-40"
                        >
                          {exportando === i ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <FileDown className="h-3.5 w-3.5" />
                          )}
                          PDF
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            ))}

            {/* Respuesta en curso */}
            {pensando && (
              <div className="flex justify-start">
                <div className="max-w-[85%] px-4 py-3 rounded-2xl rounded-bl-md bg-white/[0.05] border border-white/10 space-y-2">
                  {borrador ? (
                    <AgenteMarkdown texto={borrador} />
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="flex gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-bounce" />
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-bounce [animation-delay:0.15s]" />
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-bounce [animation-delay:0.3s]" />
                      </span>
                      <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest">
                        {estado || "Pensando..."}
                      </span>
                    </div>
                  )}
                  {borrador && estado && (
                    <p className="text-[10px] font-black text-amber-400/70 uppercase tracking-widest">
                      {estado}
                    </p>
                  )}
                </div>
              </div>
            )}
          </>
        )}
        <div ref={finalRef} />
      </div>

      {error && (
        <div className="vda-shake mt-3 text-rose-300 text-[11px] font-black text-center bg-rose-500/10 p-3 rounded-xl border border-rose-500/25 uppercase tracking-wider">
          {error}
        </div>
      )}

      {/* Composer */}
      <div className="mt-3 flex items-end gap-2">
        <textarea
          rows={1}
          value={pregunta}
          onChange={(e) => setPregunta(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              enviar(pregunta);
            }
          }}
          placeholder="Pregúntale a VIDA... (Enter para enviar)"
          className="flex-1 resize-none px-4 py-3.5 bg-white/[0.04] border border-white/10 rounded-2xl text-sm font-bold text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-400/25 focus:border-amber-400/60 transition-all max-h-40"
        />
        {pensando ? (
          <button
            onClick={detener}
            className="p-3.5 rounded-2xl bg-rose-500/15 border border-rose-500/30 text-rose-300 hover:bg-rose-500/25 transition-colors"
            title="Detener"
          >
            <Square className="h-5 w-5" />
          </button>
        ) : (
          <button
            onClick={() => enviar(pregunta)}
            disabled={!pregunta.trim()}
            className="p-3.5 rounded-2xl bg-gradient-to-r from-amber-500 via-orange-400 to-red-500 text-slate-950 shadow-lg shadow-amber-500/20 hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            title="Enviar"
          >
            {pensando ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
          </button>
        )}
      </div>
    </div>
  );
}
