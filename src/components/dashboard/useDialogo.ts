"use client";

import { type RefObject, useEffect } from "react";

// Comportamiento mínimo de un diálogo modal accesible, sin librerías:
// al abrir enfoca el elemento inicial (o el primero enfocable), Esc cierra,
// Tab circula dentro del diálogo y, al cerrar, el foco vuelve a donde estaba.

const ENFOCABLES =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useDialogo(
  contenedor: RefObject<HTMLElement | null>,
  onCerrar: () => void,
  inicial?: RefObject<HTMLElement | null>
): void {
  // Foco de entrada y de regreso: solo al montar y desmontar el diálogo.
  useEffect(() => {
    const previo = document.activeElement;
    const objetivo =
      inicial?.current ?? contenedor.current?.querySelector<HTMLElement>(ENFOCABLES);
    objetivo?.focus();
    return () => {
      if (previo instanceof HTMLElement) previo.focus();
    };
  }, [contenedor, inicial]);

  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCerrar();
        return;
      }
      const nodo = contenedor.current;
      if (e.key !== "Tab" || !nodo) return;
      const enfocables = Array.from(nodo.querySelectorAll<HTMLElement>(ENFOCABLES));
      if (enfocables.length === 0) return;
      const primero = enfocables[0];
      const ultimo = enfocables[enfocables.length - 1];
      const activo = document.activeElement;
      const fuera = !(activo instanceof Node && nodo.contains(activo));
      if (e.shiftKey && (activo === primero || fuera)) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && (activo === ultimo || fuera)) {
        e.preventDefault();
        primero.focus();
      }
    };
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, [contenedor, onCerrar]);
}
