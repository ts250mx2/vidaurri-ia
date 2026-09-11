"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Link2, Loader2, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { porcentaje } from "@/lib/formato";
import type { ClienteDescuento } from "@/lib/clientes-descuento";
import type { MotivoSugerencia, SugerenciaBdav } from "@/lib/sugerencias-bdav";
import { useDialogo } from "@/components/dashboard/useDialogo";

// Relacionar un cliente del padrón con uno del catálogo de clientes de bdav:
// propone candidatos (mismo celular, mismo RFC, nombre parecido) y deja buscar
// a mano por nombre o teléfono. Al elegir uno se guarda solo la relación
// (PATCH { idClienteBdav }); el nombre y el descuento del padrón no se tocan.

const ESPERA_BUSQUEDA_MS = 300;
const lbl = "text-[10px] font-black text-slate-500 uppercase tracking-widest";
const inputCls =
  "block w-full px-4 py-2.5 bg-white/[0.03] border border-white/10 rounded-xl text-sm font-bold text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-400/25 focus:border-amber-400/60 transition-all";
const btnSecundario =
  "flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/[0.05] border border-white/10 text-slate-300 text-[11px] font-black uppercase tracking-widest hover:text-amber-300 transition-all disabled:opacity-40";

const MOTIVO_TEXTO: Record<MotivoSugerencia, string> = {
  celular: "Mismo celular",
  rfc: "Mismo RFC",
  nombre: "Nombre parecido",
};

/** Cliente del catálogo con el que quedó ligado el registro (para el aviso). */
export interface ClienteCatalogoLigado {
  id: number;
  nombre: string;
}

interface Respuesta {
  clave: string;
  sugerencias: SugerenciaBdav[];
  error: string;
  catalogoNoDisponible: boolean;
}

interface CuerpoSugerencias {
  sugerencias?: SugerenciaBdav[];
  catalogoNoDisponible?: boolean;
  error?: string;
}

interface CuerpoRelacion {
  registro?: ClienteDescuento;
  catalogo?: ClienteCatalogoLigado | null;
  error?: string;
}

type Props = {
  registro: ClienteDescuento;
  /** Debe ser estable (useCallback): el diálogo lo usa en sus efectos. */
  onCerrar: () => void;
  onRelacionado: (registro: ClienteDescuento, catalogo: ClienteCatalogoLigado) => void;
};

function mensajeDe(err: unknown, respaldo: string): string {
  return err instanceof Error ? err.message : respaldo;
}

export function DialogoRelacionarBdav({ registro, onCerrar, onRelacionado }: Props) {
  const router = useRouter();
  const dialogoRef = useRef<HTMLDivElement>(null);
  const busquedaRef = useRef<HTMLInputElement>(null);

  const [busqueda, setBusqueda] = useState("");
  const [busquedaAplicada, setBusquedaAplicada] = useState("");
  const [respuesta, setRespuesta] = useState<Respuesta | null>(null);
  const [ligando, setLigando] = useState<number | null>(null);
  const [errorLigar, setErrorLigar] = useState("");

  // Mientras se guarda una relación no se cierra (ni con Esc ni clic fuera):
  // si no, el aviso de "se relacionó" aparecería con el diálogo ya ido.
  const cerrar = useCallback(() => {
    if (ligando === null) onCerrar();
  }, [ligando, onCerrar]);
  useDialogo(dialogoRef, cerrar, busquedaRef);

  // La búsqueda manual se aplica cuando el usuario deja de teclear.
  useEffect(() => {
    const temporizador = setTimeout(() => setBusquedaAplicada(busqueda.trim()), ESPERA_BUSQUEDA_MS);
    return () => clearTimeout(temporizador);
  }, [busqueda]);

  // Sugerencias: una consulta por clave (búsqueda aplicada); la que llegue
  // tarde se descarta. Sin búsqueda, las automáticas por celular, RFC y nombre.
  const clave = busquedaAplicada;
  useEffect(() => {
    let cancelado = false;
    const parametros = new URLSearchParams();
    if (clave) parametros.set("busqueda", clave);
    (async () => {
      let resultado: Respuesta;
      try {
        const res = await fetch(`/api/clientes-descuento/${registro.id}/sugerencias-bdav?${parametros}`);
        if (res.status === 401) {
          router.push("/login");
          return;
        }
        const cuerpo = (await res.json().catch(() => null)) as CuerpoSugerencias | null;
        resultado =
          res.ok && cuerpo?.sugerencias
            ? {
                clave,
                sugerencias: cuerpo.sugerencias,
                error: "",
                catalogoNoDisponible: cuerpo.catalogoNoDisponible === true,
              }
            : {
                clave,
                sugerencias: [],
                error: cuerpo?.error ?? "No se pudieron buscar sugerencias",
                catalogoNoDisponible: false,
              };
      } catch (err: unknown) {
        resultado = {
          clave,
          sugerencias: [],
          error: mensajeDe(err, "No se pudieron buscar sugerencias"),
          catalogoNoDisponible: false,
        };
      }
      if (!cancelado) setRespuesta(resultado);
    })();
    return () => {
      cancelado = true;
    };
  }, [clave, registro.id, router]);

  const relacionar = async (sugerencia: SugerenciaBdav) => {
    setLigando(sugerencia.id);
    setErrorLigar("");
    try {
      const res = await fetch(`/api/clientes-descuento/${registro.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idClienteBdav: sugerencia.id }),
      });
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      const cuerpo = (await res.json().catch(() => null)) as CuerpoRelacion | null;
      if (!res.ok || !cuerpo?.registro) throw new Error(cuerpo?.error ?? "No se pudo relacionar");
      onRelacionado(cuerpo.registro, cuerpo.catalogo ?? { id: sugerencia.id, nombre: sugerencia.nombre });
    } catch (err: unknown) {
      setErrorLigar(mensajeDe(err, "No se pudo relacionar"));
      setLigando(null);
    }
  };

  const cargando = respuesta?.clave !== clave;
  const sugerencias = respuesta?.sugerencias ?? [];
  const celulares = registro.telefonos.length > 0 ? registro.telefonos.join(", ") : "sin celular";

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={cerrar}
    >
      <div
        ref={dialogoRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cd-relacionar-titulo"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl bg-[#0a101c] border border-white/10 rounded-2xl shadow-2xl shadow-black/60 flex flex-col max-h-[90vh]"
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/10">
          <Link2 className="h-4 w-4 text-amber-300 shrink-0" />
          <h2 id="cd-relacionar-titulo" className="text-base font-black text-white">
            Relacionar con el catálogo de clientes
          </h2>
          <button
            onClick={cerrar}
            disabled={ligando !== null}
            aria-label="Cerrar"
            className="ml-auto p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/[0.06] transition-all disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto">
          <p className="text-sm text-slate-300 leading-relaxed">
            <b className="text-white">{registro.cliente}</b> (
            <span className="font-mono tabular-nums">{celulares}</span>
            {registro.rfc && (
              <>
                , RFC <span className="font-mono">{registro.rfc}</span>
              </>
            )}
            ) no tiene relación con el catálogo de clientes de bdav. Elige con cuál relacionarlo; el
            nombre y el descuento del padrón se quedan como están.
          </p>

          <div>
            <label htmlFor="cd-relacionar-busqueda" className={lbl}>
              Buscar en el catálogo
            </label>
            <div className="relative mt-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-600" />
              <input
                ref={busquedaRef}
                id="cd-relacionar-busqueda"
                type="search"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Nombre o teléfono… (vacío = sugerencias automáticas)"
                className={cn(inputCls, "pl-9")}
              />
            </div>
          </div>

          {errorLigar && (
            <div className="flex items-center gap-2 bg-rose-500/10 border border-rose-500/25 rounded-xl p-3 text-rose-300 text-sm font-bold">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {errorLigar}
            </div>
          )}
          {respuesta?.clave === clave && respuesta.error && (
            <div className="flex items-center gap-2 bg-rose-500/10 border border-rose-500/25 rounded-xl p-3 text-rose-300 text-sm font-bold">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {respuesta.error}
            </div>
          )}
          {respuesta?.clave === clave && respuesta.catalogoNoDisponible && (
            <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/25 rounded-xl p-3 text-amber-300 text-sm font-bold">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              El catálogo de clientes de bdav no respondió. Intenta de nuevo en un momento.
            </div>
          )}

          {cargando ? (
            <div className="flex items-center gap-2 text-slate-400 text-sm font-bold py-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              {clave ? "Buscando en el catálogo…" : "Buscando clientes parecidos…"}
            </div>
          ) : sugerencias.length === 0 ? (
            !respuesta?.error &&
            !respuesta?.catalogoNoDisponible && (
              <p className="text-sm text-slate-400 py-2">
                {clave
                  ? "No hay clientes en el catálogo con esa búsqueda."
                  : "No encontré clientes parecidos por celular, RFC ni nombre. Busca a mano por nombre o teléfono."}
              </p>
            )
          ) : (
            <ul className="divide-y divide-white/[0.06] border border-white/10 rounded-2xl overflow-hidden">
              {sugerencias.map((s) => (
                <li key={s.id} className="flex items-center gap-3 px-4 py-3 bg-white/[0.02]">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-black text-slate-100">{s.nombre}</span>
                      {s.activo === 0 && (
                        <span className="text-[9px] font-black uppercase tracking-widest text-rose-300">
                          inactivo
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-[11px] font-bold text-slate-500 truncate">
                      #{s.id}
                      {s.telefono && <> · {s.telefono}</>}
                      {s.rfc && <> · {s.rfc}</>}
                      {s.ciudad && <> · {s.ciudad}</>}
                      {" · "}
                      {porcentaje(s.descuento)} de descuento
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {s.motivos.map((m) => (
                        <span
                          key={m}
                          className={cn(
                            "px-2 py-0.5 rounded-full border text-[9px] font-black uppercase tracking-widest",
                            m === "nombre"
                              ? "bg-white/[0.04] border-white/10 text-slate-400"
                              : "bg-emerald-500/10 border-emerald-500/25 text-emerald-300"
                          )}
                        >
                          {MOTIVO_TEXTO[m]}
                          {m === "nombre" && ` · ${s.similitud}%`}
                        </span>
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={() => void relacionar(s)}
                    disabled={ligando !== null}
                    className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-amber-500 text-slate-950 text-[11px] font-black uppercase tracking-widest hover:brightness-110 transition-all disabled:opacity-40 shrink-0"
                  >
                    {ligando === s.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Link2 className="h-3.5 w-3.5" />
                    )}
                    Relacionar
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-white/10">
          <button onClick={cerrar} disabled={ligando !== null} className={btnSecundario}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
