"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { entero } from "@/lib/formato";
import type { SaldoAxon } from "@/lib/axon-creditos";

// Chip del encabezado con el saldo de tokens de WhatsApp (Axon Logic), como
// recomienda su guía: siempre visible, refrescado cada 5 min y en rojo cuando
// quedan menos de 7 días. Si Axon no está configurado o falla, no se muestra:
// el encabezado no debe romperse por esto.

const REFRESCO_MS = 5 * 60_000;
const DIAS_ALERTA = 7;

export function ChipSaldoAxon() {
  const [saldo, setSaldo] = useState<SaldoAxon | null>(null);

  useEffect(() => {
    let activo = true;
    const cargar = async () => {
      try {
        const res = await fetch("/api/axon/saldo");
        if (!res.ok) return;
        const cuerpo = (await res.json().catch(() => null)) as { saldo?: SaldoAxon } | null;
        if (activo && cuerpo?.saldo) setSaldo(cuerpo.saldo);
      } catch {
        // sin saldo no hay chip; nada que romper
      }
    };
    void cargar();
    const temporizador = setInterval(() => void cargar(), REFRESCO_MS);
    return () => {
      activo = false;
      clearInterval(temporizador);
    };
  }, []);

  if (!saldo) return null;
  const bajo = saldo.diasRestantes !== null && saldo.diasRestantes < DIAS_ALERTA;

  return (
    <Link
      href="/dashboard/axon"
      title={
        bajo
          ? "Quedan menos de 7 días de tokens de WhatsApp: compra un pack"
          : "Créditos de WhatsApp en Axon Logic"
      }
      className={cn(
        "hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl border transition-colors",
        bajo
          ? "bg-rose-500/10 border-rose-500/25 text-rose-300 hover:bg-rose-500/20"
          : "bg-white/[0.04] border-white/10 text-slate-300 hover:bg-white/[0.08]"
      )}
    >
      <span className="text-base leading-none">🪙</span>
      <span className="text-[10px] font-black uppercase tracking-widest tabular-nums">
        {entero(saldo.saldo)} <span className="hidden md:inline">tokens</span>
      </span>
    </Link>
  );
}
