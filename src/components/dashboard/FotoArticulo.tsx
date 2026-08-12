"use client";

import { useEffect, useState } from "react";
import { ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";

// Foto del artículo servida por el proxy (catálogo de Aldo Autopartes por
// código). Si no existe, muestra un marcador discreto en vez de un ícono roto.
export function FotoArticulo({
  codigo,
  thumb = false,
  className,
}: {
  codigo: string;
  thumb?: boolean;
  className?: string;
}) {
  const [falla, setFalla] = useState(false);

  // Reinicia el estado de error al cambiar de código (reutilización en tablas).
  useEffect(() => {
    setFalla(false);
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
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={`Foto ${codigo}`}
      loading="lazy"
      onError={() => setFalla(true)}
      className={cn("object-contain bg-white", className)}
    />
  );
}
