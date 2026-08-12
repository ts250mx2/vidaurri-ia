"use client";

import { useState } from "react";
import { ArrowRight, Eye, EyeOff, Loader2, Lock, User } from "lucide-react";
import { cn } from "@/lib/utils";

export default function LoginPage() {
  const [usuario, setUsuario] = useState("");
  const [clave, setClave] = useState("");
  const [verClave, setVerClave] = useState(false);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setCargando(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usuario, clave }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "No fue posible iniciar sesión");
      // Recarga dura para que el middleware vea la cookie recién puesta.
      window.location.href = "/dashboard";
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error desconocido");
      setCargando(false);
    }
  };

  return (
    <div className="vda-stage min-h-screen flex flex-col items-center justify-center px-4 py-10">
      {/* Auroras de fondo */}
      <div className="vda-aurora w-[420px] h-[420px] -top-32 -left-24 bg-amber-500/25" />
      <div className="vda-aurora w-[380px] h-[380px] -bottom-28 -right-20 bg-red-500/20 [animation-delay:-7s]" />

      <div className="relative w-full max-w-md">
        {/* Marca */}
        <div className="flex flex-col items-center mb-8 text-center">
          <div className="relative w-[4.5rem] h-[4.5rem] mb-5 rounded-2xl bg-white/[0.05] border border-white/10 backdrop-blur-xl flex items-center justify-center shadow-lg shadow-amber-500/10">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt="Vidaurri IA" className="w-12 h-12 object-contain" />
            <span className="absolute -bottom-1.5 -right-1.5 flex h-4 w-4">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-60" />
              <span className="relative inline-flex rounded-full h-4 w-4 bg-amber-500 border-2 border-[#060a12]" />
            </span>
          </div>
          <h1 className="text-4xl font-black tracking-tighter uppercase">
            Vidaurri <span className="vda-gradient-text">IA</span>
          </h1>
          <p className="mt-2 text-[11px] font-black text-slate-500 uppercase tracking-[0.35em]">
            Auto Partes Vidaurri
          </p>
        </div>

        {/* Tarjeta de login */}
        <div className="relative bg-white/[0.045] backdrop-blur-2xl rounded-3xl border border-white/10 shadow-2xl shadow-black/60 overflow-hidden">
          <div className="vda-card-accent absolute top-0 inset-x-0 h-px" />

          <div className="p-8">
            <div className="mb-7">
              <h2 className="text-xl font-black text-white leading-none">Inicio de sesión</h2>
              <p className="text-[11px] font-bold text-slate-500 mt-2 uppercase tracking-widest">
                Usa tu usuario del punto de venta
              </p>
            </div>

            <form className="space-y-5" onSubmit={enviar}>
              {/* Usuario */}
              <div className="space-y-1.5">
                <label
                  htmlFor="usuario"
                  className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] pl-1"
                >
                  Usuario
                </label>
                <div className="relative group">
                  <User className="absolute top-1/2 -translate-y-1/2 left-4 h-5 w-5 text-slate-500 group-focus-within:text-amber-400 transition-colors" />
                  <input
                    id="usuario"
                    name="usuario"
                    type="text"
                    required
                    autoComplete="username"
                    className="block w-full px-12 py-4 bg-white/[0.03] border border-white/10 rounded-xl text-sm font-bold text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-400/25 focus:border-amber-400/60 transition-all"
                    placeholder="USUARIO"
                    value={usuario}
                    onChange={(e) => setUsuario(e.target.value)}
                  />
                </div>
              </div>

              {/* Contraseña */}
              <div className="space-y-1.5">
                <label
                  htmlFor="clave"
                  className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] pl-1"
                >
                  Contraseña
                </label>
                <div className="relative group">
                  <Lock className="absolute top-1/2 -translate-y-1/2 left-4 h-5 w-5 text-slate-500 group-focus-within:text-amber-400 transition-colors" />
                  <input
                    id="clave"
                    name="clave"
                    type={verClave ? "text" : "password"}
                    required
                    autoComplete="current-password"
                    className="block w-full pl-12 pr-12 py-4 bg-white/[0.03] border border-white/10 rounded-xl text-sm font-bold text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-400/25 focus:border-amber-400/60 transition-all"
                    placeholder="CONTRASEÑA"
                    value={clave}
                    onChange={(e) => setClave(e.target.value)}
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setVerClave((v) => !v)}
                    className="absolute top-1/2 -translate-y-1/2 right-4 text-slate-500 hover:text-amber-400 transition-colors"
                    aria-label={verClave ? "Ocultar contraseña" : "Mostrar contraseña"}
                  >
                    {verClave ? <EyeOff className="h-4.5 w-4.5" /> : <Eye className="h-4.5 w-4.5" />}
                  </button>
                </div>
              </div>

              {error && (
                <div className="vda-shake text-rose-300 text-[11px] font-black text-center bg-rose-500/10 p-3 rounded-xl border border-rose-500/25 uppercase tracking-wider">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={cargando}
                className={cn(
                  "group relative w-full flex items-center justify-between py-4 px-7 rounded-xl font-black overflow-hidden",
                  "bg-gradient-to-r from-amber-500 via-orange-400 to-red-500 text-slate-950",
                  "shadow-xl shadow-amber-500/20 hover:shadow-amber-400/30 hover:brightness-110",
                  "transition-all duration-300 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed",
                  cargando && "opacity-70"
                )}
              >
                <span className="text-[13px] uppercase tracking-[0.2em] relative z-10 flex items-center gap-2">
                  {cargando && <Loader2 className="h-4 w-4 animate-spin" />}
                  {cargando ? "Conectando..." : "Iniciar Sesión"}
                </span>
                <ArrowRight className="h-5 w-5 relative z-10 group-hover:translate-x-1 transition-transform" />
                {/* barrido de brillo al hover */}
                <div className="absolute top-0 -left-[100%] w-[50%] h-full bg-white/25 skew-x-[-30deg] group-hover:left-[120%] transition-all duration-700 ease-in-out" />
              </button>
            </form>
          </div>

          <div className="px-8 py-4 bg-black/25 border-t border-white/[0.06] text-center">
            <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest">
              © {new Date().getFullYear()} Auto Partes Vidaurri · Todos los derechos reservados
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
