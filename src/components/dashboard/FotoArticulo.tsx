"use client";

import { useEffect, useState } from "react";
import { ImageOff, X, ZoomIn, ZoomOut } from "lucide-react";
import { cn } from "@/lib/utils";

// Foto del artículo servida por el proxy (catálogo de Aldo Autopartes por
// código). Si no existe, muestra un marcador discreto en vez de un ícono roto.
// Con `ampliable`, al hacer clic se abre un visor a pantalla completa con zoom.

const ZOOM_MIN = 1;
const ZOOM_MAX = 4;
const ZOOM_PASO = 0.5;

function VisorFoto({
  src,
  codigo,
  onCerrar,
}: {
  src: string;
  codigo: string;
  onCerrar: () => void;
}) {
  const [zoom, setZoom] = useState(1);

  // Cierra con Escape mientras el visor está abierto.
  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCerrar();
    };
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, [onCerrar]);

  const ajustar = (delta: number) =>
    setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((z + delta) * 10) / 10)));

  const botonCls =
    "p-2 rounded-xl bg-white/[0.06] border border-white/10 text-slate-300 hover:text-white hover:bg-white/[0.12] transition-colors disabled:opacity-30";

  return (
    <div
      className="fixed inset-0 z-[95] bg-black/90 backdrop-blur-sm flex flex-col p-4"
      onClick={(e) => {
        // No debe cerrar también el modal de detalle que está detrás.
        e.stopPropagation();
        onCerrar();
      }}
    >
      {/* Barra de controles */}
      <div
        className="flex items-center justify-between gap-3 pb-3"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-[11px] font-black text-amber-300 uppercase tracking-widest truncate">
          Foto · {codigo}
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => ajustar(-ZOOM_PASO)}
            disabled={zoom <= ZOOM_MIN}
            className={botonCls}
            aria-label="Alejar"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <span className="text-[11px] font-black text-slate-300 w-12 text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => ajustar(ZOOM_PASO)}
            disabled={zoom >= ZOOM_MAX}
            className={botonCls}
            aria-label="Acercar"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <button onClick={onCerrar} className={botonCls} aria-label="Cerrar visor">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Lienzo: con zoom > 100% se desplaza con el scroll; doble clic alterna 100%/200%. */}
      <div
        className="flex-1 overflow-auto rounded-2xl border border-white/10 bg-white"
        onClick={(e) => e.stopPropagation()}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={`Foto ${codigo}`}
          draggable={false}
          onDoubleClick={() => setZoom((z) => (z >= 2 ? 1 : 2))}
          className={cn(
            "select-none",
            zoom === 1
              ? "w-full h-full object-contain cursor-zoom-in"
              : "max-w-none cursor-zoom-out"
          )}
          style={zoom > 1 ? { width: `${zoom * 100}%` } : undefined}
        />
      </div>
    </div>
  );
}

export function FotoArticulo({
  codigo,
  thumb = false,
  ampliable = false,
  className,
}: {
  codigo: string;
  thumb?: boolean;
  /** Permite abrir la foto en un visor a pantalla completa con zoom. */
  ampliable?: boolean;
  className?: string;
}) {
  const [falla, setFalla] = useState(false);
  const [visorAbierto, setVisorAbierto] = useState(false);

  // Reinicia el estado de error al cambiar de código (reutilización en tablas).
  useEffect(() => {
    setFalla(false);
    setVisorAbierto(false);
  }, [codigo]);

  const src = `/api/articulos/foto?codigo=${encodeURIComponent(codigo)}${thumb ? "&thumb=1" : ""}`;

  if (falla) {
    return (
      <div
        className={cn(
          "flex items-center justify-center bg-white/[0.03] border border-white/10 text-slate-600",
          className
        )}
        title="Sin foto en el catálogo"
      >
        <ImageOff className={thumb ? "h-4 w-4" : "h-8 w-8"} />
      </div>
    );
  }

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={`Foto ${codigo}`}
        loading="lazy"
        onError={() => setFalla(true)}
        onClick={ampliable ? () => setVisorAbierto(true) : undefined}
        title={ampliable ? "Clic para ampliar" : undefined}
        className={cn("object-contain bg-white", ampliable && "cursor-zoom-in", className)}
      />
      {visorAbierto && (
        // El visor amplía la foto en tamaño completo (sin thumb).
        <VisorFoto
          src={`/api/articulos/foto?codigo=${encodeURIComponent(codigo)}`}
          codigo={codigo}
          onCerrar={() => setVisorAbierto(false)}
        />
      )}
    </>
  );
}
