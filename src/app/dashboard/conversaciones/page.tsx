"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Globe,
  Loader2,
  MessageCircle,
  RefreshCw,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { entero, fechaCorta, hoyISO } from "@/lib/formato";
import {
  Contacto,
  DetalleConversacion,
  hora,
  type ConversacionResumen,
} from "@/components/dashboard/DetalleConversacion";

// Historial de conversaciones del Vendedor IA. Pestaña WhatsApp: agrupado por
// contacto — el cliente del padrón (todos sus celulares juntos) o, si no está
// dado de alta, el teléfono —; el clic en un contacto baja a sus conversaciones
// por día y teléfono, y el clic en una conversación abre el chat. Pestaña Chat
// web: las sesiones de la página, una por visita y día. Detrás del login del
// panel: aquí hay teléfonos reales de clientes.

interface PaginaConversaciones {
  conversaciones: ConversacionResumen[];
  total: number;
  totalMensajes: number;
  porCanal: { whatsapp: number; web: number; mostrador: number };
  porPagina: number;
}

interface ContactoResumen {
  clave: string;
  idCliente: number | null;
  cliente: string | null;
  telefonos: string[];
  conversaciones: number;
  mensajes: number;
  primeraEn: string;
  ultimaEn: string;
}

interface PaginaContactos {
  contactos: ContactoResumen[];
  total: number;
  conversaciones: number;
  mensajes: number;
  clientes: number;
  porPagina: number;
}

type Pestana = "whatsapp" | "web";

type Datos =
  | { tipo: "contactos"; pagina: PaginaContactos }
  | { tipo: "conversaciones"; pagina: PaginaConversaciones };

/** Última respuesta del servidor, etiquetada con la consulta que la produjo:
 *  "cargando" es simplemente que la clave vigente aún no tiene respuesta. */
interface Respuesta {
  clave: string;
  datos: Datos | null;
  error: string;
}

const lbl = "text-[10px] font-black text-slate-500 uppercase tracking-widest";
const inputCls =
  "block w-full px-4 py-2.5 bg-white/[0.03] border border-white/10 rounded-xl text-sm font-bold text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-400/25 focus:border-amber-400/60 transition-all";
const btnSecundario =
  "flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/[0.05] border border-white/10 text-slate-300 text-[11px] font-black uppercase tracking-widest hover:text-amber-300 transition-all disabled:opacity-40";
const fila = "w-full text-left px-4 py-3.5 hover:bg-white/[0.03] transition-colors";

const ESPERA_BUSQUEDA_MS = 300;

const diasAtras = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString("sv-SE");
};

interface Consulta {
  pestana: Pestana;
  contacto: ContactoResumen | null;
  desde: string;
  hasta: string;
  busqueda: string;
  pagina: number;
}

/** Qué se le pide al servidor en cada vista. En el detalle de un contacto la
 *  búsqueda ya no aplica: el contacto es el filtro. */
function urlConsulta(q: Consulta): string {
  const parametros = new URLSearchParams({ desde: q.desde, hasta: q.hasta, pagina: String(q.pagina) });
  if (q.pestana === "web") {
    parametros.set("canal", "web");
    if (q.busqueda) parametros.set("busqueda", q.busqueda);
    return `/api/conversaciones?${parametros}`;
  }
  if (q.contacto) {
    parametros.set("canal", "whatsapp");
    parametros.set("contacto", q.contacto.clave);
    return `/api/conversaciones?${parametros}`;
  }
  if (q.busqueda) parametros.set("busqueda", q.busqueda);
  return `/api/conversaciones/contactos?${parametros}`;
}

function BotonPestana({
  activa,
  onClick,
  icono,
  children,
}: {
  activa: boolean;
  onClick: () => void;
  icono: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={activa}
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 px-4 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest border transition-all",
        activa
          ? "bg-amber-500/15 border-amber-500/40 text-amber-200"
          : "bg-white/[0.03] border-white/10 text-slate-400 hover:text-slate-200"
      )}
    >
      {icono}
      {children}
    </button>
  );
}

export default function ConversacionesPage() {
  const router = useRouter();
  const [pestana, setPestana] = useState<Pestana>("whatsapp");
  const [contacto, setContacto] = useState<ContactoResumen | null>(null);
  const [fechaInicio, setFechaInicio] = useState(diasAtras(30));
  const [fechaFin, setFechaFin] = useState(hoyISO());
  const [busqueda, setBusqueda] = useState("");
  const [busquedaAplicada, setBusquedaAplicada] = useState("");
  const [pagina, setPagina] = useState(1);
  /** Se incrementa para volver a consultar con los mismos filtros. */
  const [version, setVersion] = useState(0);
  const [respuesta, setRespuesta] = useState<Respuesta | null>(null);
  const [abierta, setAbierta] = useState<number | null>(null);

  const consulta: Consulta = {
    pestana,
    contacto,
    desde: fechaInicio,
    hasta: fechaFin,
    busqueda: busquedaAplicada,
    pagina,
  };
  const url = urlConsulta(consulta);
  const clave = `${version}|${url}`;

  // La búsqueda se aplica cuando el usuario deja de teclear.
  useEffect(() => {
    const temporizador = setTimeout(() => {
      setBusquedaAplicada(busqueda.trim());
      setPagina(1);
    }, ESPERA_BUSQUEDA_MS);
    return () => clearTimeout(temporizador);
  }, [busqueda]);

  // Una consulta por clave; la respuesta de una consulta vieja que llegue
  // tarde se descarta.
  useEffect(() => {
    let cancelado = false;
    const tipo: Datos["tipo"] = url.includes("/contactos?") ? "contactos" : "conversaciones";
    (async () => {
      try {
        const res = await fetch(url);
        if (res.status === 401) {
          router.push("/login");
          return;
        }
        const cuerpo = (await res.json().catch(() => null)) as
          | ((PaginaContactos | PaginaConversaciones) & { error?: string })
          | null;
        if (!res.ok || !cuerpo || cuerpo.error) {
          throw new Error(cuerpo?.error ?? "No se pudo consultar la bitácora");
        }
        if (cancelado) return;
        const datos: Datos =
          tipo === "contactos"
            ? { tipo, pagina: cuerpo as PaginaContactos }
            : { tipo, pagina: cuerpo as PaginaConversaciones };
        setRespuesta({ clave, datos, error: "" });
      } catch (err: unknown) {
        if (!cancelado) {
          setRespuesta({
            clave,
            datos: null,
            error: err instanceof Error ? err.message : "Error al consultar",
          });
        }
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [clave, url, router]);

  const cargando = respuesta?.clave !== clave;
  // Mientras llega la consulta nueva se sigue mostrando la anterior.
  const datos = respuesta?.datos ?? null;
  const error = respuesta?.clave === clave ? respuesta.error : "";

  const recargar = () => setVersion((v) => v + 1);
  const cerrarDetalle = useCallback(() => setAbierta(null), []);

  const cambiarPestana = (nueva: Pestana) => {
    setPestana(nueva);
    setContacto(null);
    setPagina(1);
  };
  const abrirContacto = (c: ContactoResumen) => {
    setContacto(c);
    setPagina(1);
  };
  const volverAContactos = () => {
    setContacto(null);
    setPagina(1);
  };

  const total = datos?.pagina.total ?? 0;
  const porPagina = datos?.pagina.porPagina ?? 50;
  const totalPaginas = Math.max(1, Math.ceil(total / porPagina));

  const tarjetas = !datos
    ? []
    : datos.tipo === "contactos"
      ? [
          { titulo: "Contactos", valor: entero(datos.pagina.total), color: "text-slate-200" },
          { titulo: "Dados de alta", valor: entero(datos.pagina.clientes), color: "text-emerald-300" },
          { titulo: "Conversaciones", valor: entero(datos.pagina.conversaciones), color: "text-slate-200" },
          { titulo: "Mensajes", valor: entero(datos.pagina.mensajes), color: "text-amber-300" },
        ]
      : [
          {
            titulo: pestana === "web" ? "Visitas" : "Conversaciones",
            valor: entero(datos.pagina.total),
            color: pestana === "web" ? "text-cyan-300" : "text-emerald-300",
          },
          { titulo: "Mensajes", valor: entero(datos.pagina.totalMensajes), color: "text-amber-300" },
        ];

  const subtitulo = cargando
    ? "Consultando..."
    : !datos
      ? "Sin datos"
      : datos.tipo === "contactos"
        ? `${entero(datos.pagina.total)} contactos por WhatsApp en el rango`
        : pestana === "web"
          ? `${entero(datos.pagina.total)} visitas del chat web en el rango`
          : `${entero(datos.pagina.total)} conversaciones en el rango`;

  return (
    <div className="space-y-4">
      {/* Encabezado */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight">
            Conversaciones del Vendedor IA
          </h1>
          <p className={cn(lbl, "mt-1")}>{subtitulo}</p>
        </div>
        <button onClick={recargar} disabled={cargando} className={btnSecundario}>
          {cargando ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Actualizar
        </button>
      </div>

      {/* Pestañas y filtros */}
      <div className="bg-white/[0.02] border border-white/10 rounded-2xl p-4 space-y-4">
        <div role="tablist" className="flex flex-wrap gap-2">
          <BotonPestana
            activa={pestana === "whatsapp"}
            onClick={() => cambiarPestana("whatsapp")}
            icono={<MessageCircle className="h-3.5 w-3.5" />}
          >
            WhatsApp
          </BotonPestana>
          <BotonPestana
            activa={pestana === "web"}
            onClick={() => cambiarPestana("web")}
            icono={<Globe className="h-3.5 w-3.5" />}
          >
            Chat web
          </BotonPestana>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className={lbl}>Desde</label>
            <input
              type="date"
              value={fechaInicio}
              onChange={(e) => {
                setFechaInicio(e.target.value);
                setPagina(1);
              }}
              className={cn(inputCls, "mt-1 [color-scheme:dark]")}
            />
          </div>
          <div>
            <label className={lbl}>Hasta</label>
            <input
              type="date"
              value={fechaFin}
              onChange={(e) => {
                setFechaFin(e.target.value);
                setPagina(1);
              }}
              className={cn(inputCls, "mt-1 [color-scheme:dark]")}
            />
          </div>
          <div className="col-span-2">
            <label className={lbl}>{pestana === "web" ? "Sesión" : "Teléfono o cliente"}</label>
            <div className="relative mt-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-600" />
              <input
                type="search"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                disabled={pestana === "whatsapp" && contacto !== null}
                placeholder={
                  pestana === "web" ? "Número de sesión…" : "Número o nombre del cliente…"
                }
                className={cn(inputCls, "pl-9 disabled:opacity-40")}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Tarjetas de totales */}
      {datos && (
        <div className={cn("grid grid-cols-2 gap-3", tarjetas.length === 4 && "lg:grid-cols-4")}>
          {tarjetas.map((t) => (
            <div key={t.titulo} className="bg-white/[0.02] border border-white/10 rounded-2xl p-4">
              <p className={lbl}>{t.titulo}</p>
              <p className={cn("text-2xl font-black mt-1 tabular-nums", t.color)}>{t.valor}</p>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 bg-rose-500/10 border border-rose-500/25 rounded-2xl p-4 text-rose-300 text-sm font-bold">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Lista */}
      <div className="bg-white/[0.02] border border-white/10 rounded-2xl overflow-hidden">
        {pestana === "whatsapp" && contacto && (
          <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-white/10 bg-white/[0.02]">
            <button onClick={volverAContactos} className={btnSecundario}>
              <ArrowLeft className="h-3.5 w-3.5" />
              Contactos
            </button>
            <div className="min-w-0">
              {contacto.cliente ? (
                <p className="text-sm font-black text-slate-100 truncate">{contacto.cliente}</p>
              ) : (
                <p className="text-sm font-black text-amber-300/90">Cliente sin dar de alta</p>
              )}
              <p className="font-mono text-[12px] font-bold text-slate-400 tabular-nums">
                {contacto.telefonos.join(" · ")}
              </p>
            </div>
          </div>
        )}

        {cargando && !datos ? (
          <div className="flex items-center justify-center gap-2 p-10 text-slate-400 text-sm font-bold">
            <Loader2 className="h-4 w-4 animate-spin" />
            Consultando la bitácora…
          </div>
        ) : !datos ? (
          <div className="p-10 text-center text-slate-500 text-sm font-bold">
            No se pudo mostrar la bitácora.
          </div>
        ) : datos.tipo === "contactos" ? (
          datos.pagina.contactos.length === 0 ? (
            <div className="p-10 text-center text-slate-500 text-sm font-bold">
              No hay conversaciones de WhatsApp en el rango seleccionado.
            </div>
          ) : (
            <ul className="divide-y divide-white/[0.06]">
              {datos.pagina.contactos.map((c) => (
                <li key={c.clave}>
                  <button onClick={() => abrirContacto(c)} className={fila}>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      {c.cliente ? (
                        <>
                          <span className="text-sm font-black text-slate-100">{c.cliente}</span>
                          <span className="font-mono text-[12px] font-bold text-slate-400 tabular-nums">
                            ({c.telefonos.join(", ")})
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="font-mono text-sm font-bold text-slate-100 tabular-nums">
                            {c.telefonos[0]}
                          </span>
                          <span className="text-[11px] font-bold text-amber-300/80">
                            (Cliente sin dar de alta)
                          </span>
                        </>
                      )}
                      <span className="ml-auto text-[11px] font-black text-slate-400 tabular-nums">
                        {entero(c.conversaciones)} {c.conversaciones === 1 ? "día" : "días"} ·{" "}
                        {entero(c.mensajes)} msjs
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] font-bold text-slate-500 tabular-nums">
                      Última: {fechaCorta(c.ultimaEn)} · {hora(c.ultimaEn)}
                      {c.conversaciones > 1 && ` · desde ${fechaCorta(c.primeraEn)}`}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : datos.pagina.conversaciones.length === 0 ? (
          <div className="p-10 text-center text-slate-500 text-sm font-bold">
            {pestana === "web"
              ? "No hay visitas del chat web en el rango seleccionado."
              : "Este contacto no tiene conversaciones en el rango seleccionado."}
          </div>
        ) : (
          <ul className="divide-y divide-white/[0.06]">
            {datos.pagina.conversaciones.map((c) => (
              <li key={c.id}>
                <button onClick={() => setAbierta(c.id)} className={fila}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    {pestana === "web" ? (
                      <Contacto c={c} />
                    ) : (
                      <>
                        <span className="text-sm font-black text-slate-100 tabular-nums">
                          {fechaCorta(c.fecha)}
                        </span>
                        <span className="font-mono text-[12px] font-bold text-slate-400 tabular-nums">
                          {c.telefono}
                        </span>
                      </>
                    )}
                    <span className="text-[11px] font-bold text-slate-500 tabular-nums">
                      {pestana === "web" && `${fechaCorta(c.fecha)} · `}
                      {hora(c.iniciadaEn)}–{hora(c.ultimaEn)}
                    </span>
                    <span className="ml-auto text-[11px] font-black text-slate-400 tabular-nums">
                      {entero(c.mensajes)} msjs
                    </span>
                  </div>
                  {c.primerMensaje && (
                    <p className="mt-1 text-[13px] text-slate-400 truncate">“{c.primerMensaje}”</p>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Paginación */}
      {datos && totalPaginas > 1 && (
        <div className="flex items-center justify-between">
          <button
            onClick={() => setPagina((p) => Math.max(1, p - 1))}
            disabled={pagina <= 1 || cargando}
            className={btnSecundario}
          >
            <ChevronLeft className="h-3.5 w-3.5" /> Anterior
          </button>
          <span className={lbl}>
            Página {entero(pagina)} de {entero(totalPaginas)}
          </span>
          <button
            onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
            disabled={pagina >= totalPaginas || cargando}
            className={btnSecundario}
          >
            Siguiente <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Detalle: la conversación como chat */}
      {abierta != null && <DetalleConversacion id={abierta} onCerrar={cerrarDetalle} />}
    </div>
  );
}
