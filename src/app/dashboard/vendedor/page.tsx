"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RotateCcw, Send, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { preguntarAgente, SesionExpiradaError } from "@/lib/agente-cliente";
import { AgenteMarkdown } from "@/components/dashboard/AgenteMarkdown";

interface Mensaje {
  rol: "usuario" | "agente";
  texto: string;
}

const ENDPOINT = "/api/chat/vendedor";
const CLAVE_STORAGE = "vendedor-conversacion";

const SUGERENCIAS = [
  "Cofre para Nissan Versa 2016",
  "Defensa delantera de Aveo",
  "¿Qué parrillas de Toyota Avanza tienen?",
  "Faros para Chevy 2010 con existencia",
  "Tolva salpicadera de Nissan",
  "Cofre de Honda Civic 2018 y su precio",
];

export default function VendedorPage() {
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [borrador, setBorrador] = useState("");
  const [pregunta, setPregunta] = useState("");
  const [estado, setEstado] = useState("");
  const [pensando, setPensando] = useState(false);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  // Espejo del texto en curso, para conservar lo parcial al detener.
  const borradorRef = useRef("");
  const finalRef = useRef<HTMLDivElement | null>(null);

  // Restaura y respalda la conversación en sessionStorage.
  useEffect(() => {
    try {
      const guardado = sessionStorage.getItem(CLAVE_STORAGE);
      if (guardado) setMensajes(JSON.parse(guardado));
    } catch {
      // storage corrupto: se inicia limpio
    }
  }, []);
  useEffect(() => {
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
        const respuesta = await preguntarAgente(
          ENDPOINT,
          limpia,
          historial.slice(0, -1),
          {
            alTexto: (t) => {
              borradorRef.current = t;
              setBorrador(t);
            },
            alEstado: setEstado,
          },
          controlador.signal
        );
        setMensajes([...historial, { rol: "agente", texto: respuesta || "…" }]);
      } catch (err: unknown) {
        if (err instanceof SesionExpiradaError) {
          window.location.href = "/login";
          return;
        }
        if (controlador.signal.aborted) {
          const parcial = borradorRef.current;
          setMensajes((previos) =>
            parcial ? [...previos, { rol: "agente", texto: parcial }] : previos
          );
        } else {
          setError(err instanceof Error ? err.message : "El Vendedor IA no pudo responder");
        }
      } finally {
        setPensando(false);
        setBorrador("");
        borradorRef.current = "";
        setEstado("");
        abortRef.current = null;
      }
    },
    [mensajes, pensando]
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
          <div className="w-11 h-11 rounded-2xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-xl">
            🛒
          </div>
          <div>
            <h1 className="text-xl font-black text-white tracking-tight leading-none">
              Vendedor <span className="text-cyan-300">IA</span>
            </h1>
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mt-1.5">
              Asesor de mostrador · Pregunta por una parte y te sugiere productos con precio
            </p>
          </div>
        </div>
        <button
          onClick={reiniciar}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/[0.05] border border-white/10 text-slate-400 text-[11px] font-black uppercase tracking-widest hover:text-white transition-all"
        >
          <RotateCcw className="h-3.5 w-3.5" /> Nueva consulta
        </button>
      </div>

      {/* Conversación */}
      <div className="flex-1 overflow-y-auto bg-white/[0.03] border border-white/10 rounded-2xl backdrop-blur-xl p-4 space-y-4">
        {vacia ? (
          <div className="h-full flex flex-col items-center justify-center gap-5 text-center px-4">
            <div className="text-5xl">🛒</div>
            <div>
              <p className="text-base font-black text-white">
                Dime qué parte busca tu cliente
              </p>
              <p className="text-[11px] font-bold text-slate-500 mt-1.5 max-w-md">
                Describe la pieza (marca, modelo, año y tipo) y te sugiero los productos del
                catálogo con su precio con IVA, existencia y ubicación en la tienda.
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2 max-w-xl">
              {SUGERENCIAS.map((s) => (
                <button
                  key={s}
                  onClick={() => enviar(s)}
                  className="px-3.5 py-2 rounded-xl bg-cyan-500/10 border border-cyan-500/25 text-cyan-200 text-[12px] font-bold hover:bg-cyan-500/20 transition-colors"
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
                      ? "bg-cyan-500/15 border-cyan-500/25 rounded-br-md text-[13px] font-bold text-cyan-100"
                      : "bg-white/[0.05] border-white/10 rounded-bl-md"
                  )}
                >
                  {m.rol === "usuario" ? m.texto : <AgenteMarkdown texto={m.texto} />}
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
                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce" />
                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce [animation-delay:0.15s]" />
                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce [animation-delay:0.3s]" />
                      </span>
                      <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest">
                        {estado || "Pensando..."}
                      </span>
                    </div>
                  )}
                  {borrador && estado && (
                    <p className="text-[10px] font-black text-cyan-400/70 uppercase tracking-widest">
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
          placeholder="Ej: cofre para versa 2016... (Enter para enviar)"
          className="flex-1 resize-none px-4 py-3.5 bg-white/[0.04] border border-white/10 rounded-2xl text-sm font-bold text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-400/25 focus:border-cyan-400/60 transition-all max-h-40"
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
            className="p-3.5 rounded-2xl bg-gradient-to-r from-cyan-500 via-sky-400 to-teal-500 text-slate-950 shadow-lg shadow-cyan-500/20 hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            title="Enviar"
          >
            <Send className="h-5 w-5" />
          </button>
        )}
      </div>
    </div>
  );
}
