"use client";

import { cn } from "@/lib/utils";

// Selector segmentado de sucursal (Matriz / Bodega Usado, y en Existencias
// también Aldo Autopartes). Genérico sobre el valor para que cada página
// declare sus opciones.

export interface OpcionSucursal<T extends string = string> {
  valor: T;
  etiqueta: string;
}

/** Opciones estándar de las páginas con dos sucursales. */
export const SUCURSALES: OpcionSucursal<"matriz" | "usadas">[] = [
  { valor: "matriz", etiqueta: "Matriz" },
  { valor: "usadas", etiqueta: "Bodega Usado" },
];

export type Sucursal = "matriz" | "usadas";

export function SelectorSucursal<T extends string>({
  opciones,
  valor,
  onCambio,
}: {
  opciones: OpcionSucursal<T>[];
  valor: T;
  onCambio: (valor: T) => void;
}) {
  return (
    <div className="inline-flex items-center gap-1 p-1 bg-white/[0.04] border border-white/10 rounded-xl">
      {opciones.map((o) => (
        <button
          key={o.valor}
          onClick={() => onCambio(o.valor)}
          className={cn(
            "px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-widest transition-colors whitespace-nowrap",
            valor === o.valor
              ? "bg-amber-500/15 text-amber-300 border border-amber-500/30"
              : "text-slate-400 hover:text-white hover:bg-white/[0.05] border border-transparent"
          )}
        >
          {o.etiqueta}
        </button>
      ))}
    </div>
  );
}
