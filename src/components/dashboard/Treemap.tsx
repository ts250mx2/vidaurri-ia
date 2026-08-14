"use client";

import { useEffect, useRef, useState } from "react";
import { calcularTreemap, type NodoTreemap } from "@/lib/treemap";
import { moneda, entero } from "@/lib/formato";
import { cn } from "@/lib/utils";

interface ItemDesglose {
  nombre: string;
  importe: number;
  piezas: number;
}

// Color estable por índice (tonos variados, buena legibilidad en tema oscuro).
function colorPara(i: number): string {
  const tono = (i * 47) % 360;
  return `hsl(${tono}, 62%, 42%)`;
}

const ALTO_DEFAULT = 520;

export function Treemap({
  datos,
  alto = ALTO_DEFAULT,
  onClickItem,
}: {
  datos: ItemDesglose[];
  alto?: number;
  /** Si se pasa, los rectángulos son clicables. */
  onClickItem?: (nombre: string) => void;
}) {
  const contenedorRef = useRef<HTMLDivElement | null>(null);
  const [ancho, setAncho] = useState(0);

  // Mide el ancho del contenedor y se re-mide al cambiar el tamaño de ventana.
  useEffect(() => {
    const medir = () => setAncho(contenedorRef.current?.clientWidth ?? 0);
    medir();
    const observador = new ResizeObserver(medir);
    if (contenedorRef.current) observador.observe(contenedorRef.current);
    return () => observador.disconnect();
  }, []);

  const total = datos.reduce((s, d) => s + d.importe, 0);
  const nodos: NodoTreemap[] = datos.map((d) => ({
    nombre: d.nombre,
    valor: d.importe,
    piezas: d.piezas,
  }));
  const rects = ancho > 0 ? calcularTreemap(nodos, ancho, alto) : [];

  return (
    <div ref={contenedorRef} className="relative w-full" style={{ height: alto }}>
      {rects.map((r, i) => {
        const item = datos.find((d) => d.nombre === r.nodo.nombre);
        const pct = total > 0 ? (r.nodo.valor / total) * 100 : 0;
        const cabeEtiqueta = r.w > 66 && r.h > 34;
        return (
          <div
            key={r.nodo.nombre}
            onClick={onClickItem ? () => onClickItem(r.nodo.nombre) : undefined}
            title={`${r.nodo.nombre}\n${moneda(r.nodo.valor)} (${pct.toFixed(1)}%)\n${entero(
              item?.piezas ?? 0
            )} piezas`}
            className={cn(
              "absolute overflow-hidden border border-black/30 transition-transform hover:z-10 hover:brightness-110 hover:scale-[1.01]",
              onClickItem ? "cursor-pointer" : "cursor-default"
            )}
            style={{
              left: r.x,
              top: r.y,
              width: r.w,
              height: r.h,
              backgroundColor: colorPara(i),
            }}
          >
            {cabeEtiqueta && (
              <div className="p-1.5 leading-tight">
                <p
                  className={cn(
                    "font-black text-white/95 uppercase tracking-tight truncate",
                    r.w > 130 ? "text-[11px]" : "text-[9px]"
                  )}
                >
                  {r.nodo.nombre}
                </p>
                <p className="text-[10px] font-bold text-white/85 truncate">
                  {moneda(r.nodo.valor)}
                </p>
                {r.h > 56 && (
                  <p className="text-[9px] font-bold text-white/70">{pct.toFixed(1)}%</p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
