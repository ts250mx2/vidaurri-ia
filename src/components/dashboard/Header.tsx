"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Database, LogOut, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SesionUsuario } from "@/types";
import { ChipSaldoAxon } from "@/components/dashboard/ChipSaldoAxon";

export function Header({ isCollapsed }: { isCollapsed: boolean }) {
  const router = useRouter();
  const [usuario, setUsuario] = useState<SesionUsuario | null>(null);

  useEffect(() => {
    let activo = true;
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (activo && json?.usuario) setUsuario(json.usuario);
      })
      .catch(() => {
        // el header no debe romperse si /me falla
      });
    return () => {
      activo = false;
    };
  }, []);

  const salir = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/login");
      router.refresh();
    }
  };

  return (
    <header className="fixed top-0 left-0 right-0 h-16 z-50 flex items-center bg-[#0a101c]/95 backdrop-blur-md border-b border-white/10">
      {/* Marca (ancho reactivo al colapso del sidebar) */}
      <div
        className={cn(
          "hidden lg:flex items-center gap-3 px-4 transition-all duration-300 shrink-0",
          isCollapsed ? "lg:w-14" : "lg:w-60"
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.svg" alt="Vidaurri IA" className="w-9 h-9 shrink-0" />
        {!isCollapsed && (
          <span className="text-lg font-black tracking-tighter uppercase whitespace-nowrap">
            Vidaurri <span className="vda-gradient-text">IA</span>
          </span>
        )}
      </div>

      <div className="flex-1 flex items-center justify-between gap-3 px-4 lg:px-6 min-w-0 pl-14 lg:pl-4">
        {/* Chip de conexión */}
        <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/[0.04] border border-white/10 min-w-0">
          <Database className="h-3.5 w-3.5 text-amber-400 shrink-0" />
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest truncate">
            Auto Partes Vidaurri · bdav
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Saldo de tokens de WhatsApp (Axon Logic) */}
          <ChipSaldoAxon />

          {/* Atajo al agente */}
          <Link
            href="/dashboard/vida"
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-300 hover:bg-amber-500/20 transition-colors"
            title="Preguntar a VIDA"
          >
            <span className="text-base leading-none">🤖</span>
            <span className="hidden md:inline text-[10px] font-black uppercase tracking-widest">
              VIDA
            </span>
          </Link>

          {/* Usuario + salir */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/[0.04] border border-white/10">
            <UserRound className="h-3.5 w-3.5 text-slate-400" />
            <span className="hidden md:inline text-[11px] font-bold text-slate-300 max-w-[140px] truncate">
              {usuario ? usuario.nombre : "..."}
            </span>
            {usuario && (
              <span className="hidden lg:inline text-[9px] font-black text-slate-500 uppercase tracking-widest">
                {usuario.perfil}
              </span>
            )}
          </div>
          <button
            onClick={salir}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-rose-300 hover:bg-rose-500/10 border border-transparent hover:border-rose-500/25 transition-colors"
            title="Cerrar sesión"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Salir</span>
          </button>
        </div>
      </div>
    </header>
  );
}
