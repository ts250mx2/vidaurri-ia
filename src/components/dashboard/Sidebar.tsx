"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, ChevronLeft, ChevronRight, Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";

type MenuItem = { nombre: string; emoji: string; href: string };
type MenuSeccion = { titulo: string; emoji: string; items: MenuItem[]; href?: string };

// El menú usa emojis (patrón de kyk-server-web); lucide solo para chevrons.
const secciones: MenuSeccion[] = [
  { titulo: "Principal", emoji: "📊", href: "/dashboard", items: [] },
  { titulo: "Artículos", emoji: "📦", href: "/dashboard/articulos", items: [] },
  { titulo: "Piezas Usadas", emoji: "♻️", href: "/dashboard/usadas", items: [] },
  {
    titulo: "Ventas",
    emoji: "🧾",
    items: [
      { nombre: "Ventas", emoji: "🧾", href: "/dashboard/ventas" },
      { nombre: "Cotizaciones", emoji: "📝", href: "/dashboard/cotizaciones" },
      { nombre: "Devoluciones", emoji: "↩️", href: "/dashboard/devoluciones" },
      { nombre: "Back Orders", emoji: "📬", href: "/dashboard/backorders" },
      { nombre: "Ventas por Parte", emoji: "🧩", href: "/dashboard/ventas/por-parte" },
      { nombre: "Ventas por Línea", emoji: "🚗", href: "/dashboard/ventas/por-linea" },
      { nombre: "Tendencias de Venta", emoji: "📈", href: "/dashboard/analisis/tendencias" },
      { nombre: "Mapa de Calor", emoji: "🔥", href: "/dashboard/analisis/mapa-calor" },
      { nombre: "Ventas por Cliente", emoji: "👥", href: "/dashboard/analisis/ventas-cliente" },
      { nombre: "Proyección de Ventas", emoji: "🔮", href: "/dashboard/analisis/proyeccion" },
    ],
  },
  {
    titulo: "Inventario",
    emoji: "🧮",
    items: [
      { nombre: "Existencias", emoji: "🗃️", href: "/dashboard/inventario/existencias" },
      { nombre: "Kardex", emoji: "📋", href: "/dashboard/inventario/kardex" },
      { nombre: "Quiebres y Reorden", emoji: "🚨", href: "/dashboard/inventario/quiebres" },
    ],
  },
  { titulo: "Clientes", emoji: "👥", href: "/dashboard/clientes", items: [] },
  {
    titulo: "Compras",
    emoji: "🚚",
    items: [
      { nombre: "Pedidos a Proveedor", emoji: "📄", href: "/dashboard/compras/pedidos" },
      { nombre: "Facturas de Compra", emoji: "🧾", href: "/dashboard/compras/facturas" },
    ],
  },
  {
    titulo: "Vendedor IA",
    emoji: "🛒",
    items: [
      { nombre: "Probar el Vendedor", emoji: "🛒", href: "/dashboard/vendedor" },
      { nombre: "Conversaciones", emoji: "💬", href: "/dashboard/conversaciones" },
      { nombre: "Clientes con Descuento", emoji: "🏷️", href: "/dashboard/clientes-descuento" },
    ],
  },
  { titulo: "VIDA · Agente IA", emoji: "🤖", href: "/dashboard/vida", items: [] },
];

export function Sidebar({
  isCollapsed,
  onToggle,
}: {
  isCollapsed: boolean;
  onToggle: () => void;
}) {
  const pathname = usePathname();
  const [abiertas, setAbiertas] = useState<Record<string, boolean>>({});
  const [movilAbierto, setMovilAbierto] = useState(false);

  // Bloquea el scroll del fondo mientras el menú móvil está abierto.
  useEffect(() => {
    document.body.style.overflow = movilAbierto ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [movilAbierto]);

  const alternarSeccion = (titulo: string, tieneActivo: boolean) => {
    setAbiertas((prev) => {
      const actual = prev[titulo] !== undefined ? prev[titulo] : tieneActivo;
      return { ...prev, [titulo]: !actual };
    });
  };

  const cerrarMovil = () => setMovilAbierto(false);

  return (
    <>
      {/* Botón flotante móvil */}
      <button
        onClick={() => setMovilAbierto((v) => !v)}
        className="lg:hidden fixed top-3 left-3 z-[70] p-2 bg-amber-500 text-slate-950 rounded-xl shadow-lg shadow-amber-500/30"
        aria-label="Abrir menú"
      >
        {movilAbierto ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {/* Backdrop móvil */}
      {movilAbierto && (
        <div
          className="lg:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-[55]"
          onClick={cerrarMovil}
        />
      )}

      <aside
        className={cn(
          "fixed left-0 top-16 h-[calc(100vh-4rem)] transition-all duration-300 z-[60] flex flex-col shadow-2xl shadow-black/50 overflow-hidden",
          "bg-[#0a101c] border-r border-white/10 text-slate-200",
          isCollapsed ? "w-[80px]" : "w-72",
          movilAbierto ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
      >
        <nav className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-4 space-y-1">
          {secciones.map((seccion) => {
            // Sección con enlace directo (sin submenú)
            if (seccion.href) {
              const activo = pathname === seccion.href;
              return (
                <Link
                  key={seccion.titulo}
                  href={seccion.href}
                  onClick={cerrarMovil}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] transition-colors",
                    activo
                      ? "bg-amber-500/15 text-amber-300 font-bold border border-amber-500/30"
                      : "text-slate-400 hover:bg-white/[0.06] hover:text-white border border-transparent",
                    isCollapsed && "justify-center px-0"
                  )}
                  title={seccion.titulo}
                >
                  <span className="text-lg leading-none">{seccion.emoji}</span>
                  {!isCollapsed && <span className="truncate">{seccion.titulo}</span>}
                </Link>
              );
            }

            const tieneActivo = seccion.items.some((item) => pathname === item.href);
            const alternado = abiertas[seccion.titulo];
            const abierta = alternado !== undefined ? alternado : tieneActivo;

            return (
              <div key={seccion.titulo}>
                <button
                  onClick={() => alternarSeccion(seccion.titulo, tieneActivo)}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] transition-colors",
                    tieneActivo ? "text-amber-300 font-bold" : "text-slate-300 hover:bg-white/[0.06]",
                    isCollapsed && "justify-center px-0"
                  )}
                  title={seccion.titulo}
                >
                  <span className="text-lg leading-none">{seccion.emoji}</span>
                  {!isCollapsed && (
                    <>
                      <span className="flex-1 text-left truncate font-bold uppercase tracking-wider text-[11px]">
                        {seccion.titulo}
                      </span>
                      <ChevronDown
                        className={cn(
                          "h-3.5 w-3.5 text-slate-500 transition-transform",
                          abierta && "rotate-180"
                        )}
                      />
                    </>
                  )}
                </button>

                <div
                  className={cn(
                    "space-y-1 overflow-hidden transition-all duration-300",
                    abierta && !isCollapsed ? "max-h-[1000px] opacity-100 mt-1" : "max-h-0 opacity-0"
                  )}
                >
                  {seccion.items.map((item) => {
                    const activo = pathname === item.href;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={cerrarMovil}
                        className={cn(
                          "flex items-center gap-3 pl-6 pr-3 py-2 rounded-xl text-[13px] transition-colors",
                          activo
                            ? "bg-amber-500/15 text-amber-300 font-bold border border-amber-500/30"
                            : "text-slate-400 hover:bg-white/[0.06] hover:text-white border border-transparent"
                        )}
                      >
                        <span className="text-base leading-none">{item.emoji}</span>
                        <span className="truncate">{item.nombre}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        {/* Pie: contraer panel */}
        <div className="border-t border-white/10 p-3 hidden lg:block">
          <button
            onClick={onToggle}
            className={cn(
              "w-full flex items-center gap-2 px-3 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest",
              "text-slate-500 hover:bg-white/[0.06] hover:text-white transition-colors",
              isCollapsed && "justify-center px-0"
            )}
          >
            {isCollapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <>
                <ChevronLeft className="h-4 w-4" /> Contraer Panel
              </>
            )}
          </button>
        </div>
      </aside>
    </>
  );
}
