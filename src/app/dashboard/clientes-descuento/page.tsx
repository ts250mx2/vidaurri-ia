"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { entero, fechaCorta, porcentaje } from "@/lib/formato";
import type { ClienteDescuento } from "@/lib/clientes-descuento";
import {
  FormularioClienteDescuento,
  type ModoFormulario,
} from "@/components/dashboard/FormularioClienteDescuento";
import { useDialogo } from "@/components/dashboard/useDialogo";

// Padrón de clientes con descuento del Vendedor IA: celular → nombre y % de
// descuento, más RFC, otros teléfonos y email, con fecha de alta. Se captura a
// mano o se carga completo desde el CSV de la lista de clientes APV. Vive en
// BDVidaurriConversaciones (no toca bdav). Detrás del login del panel: son
// teléfonos y nombres reales.

interface PaginaClientesDescuento {
  registros: ClienteDescuento[];
  total: number;
  descuentoPromedio: number;
  altasMes: number;
  porPagina: number;
  descuentoDefault: number;
}

interface Incidencia {
  linea: number;
  motivo: string;
}

interface ResumenImportacion {
  total: number;
  insertados: number;
  actualizados: number;
  sinCelular: number;
  ligadosBdav: number;
  celularRepetido: Array<{
    linea: number;
    idClienteApv: number;
    cliente: string;
    telefono: string;
    asignadoA: string;
  }>;
  omitidas: Incidencia[];
  advertencias: Incidencia[];
}

/** Última respuesta del servidor, etiquetada con la consulta que la produjo:
 *  "cargando" es simplemente que la clave vigente aún no tiene respuesta. */
interface Respuesta {
  clave: string;
  datos: PaginaClientesDescuento | null;
  error: string;
}

type Formulario = { modo: "alta" } | { modo: "edicion"; registro: ClienteDescuento };

const lbl = "text-[10px] font-black text-slate-500 uppercase tracking-widest";
const inputCls =
  "block w-full px-4 py-2.5 bg-white/[0.03] border border-white/10 rounded-xl text-sm font-bold text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-400/25 focus:border-amber-400/60 transition-all";
const btnSecundario =
  "flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/[0.05] border border-white/10 text-slate-300 text-[11px] font-black uppercase tracking-widest hover:text-amber-300 transition-all disabled:opacity-40";
const btnIcono =
  "p-2 rounded-lg border border-transparent text-slate-500 transition-all hover:bg-white/[0.06]";

const ESPERA_BUSQUEDA_MS = 300;
const AVISO_MS = 4000;

/** "2026-08-21 10:15:00" → "10:15". */
const hora = (momento: string) => momento.slice(11, 16);

export default function ClientesDescuentoPage() {
  const router = useRouter();
  const [busqueda, setBusqueda] = useState("");
  const [busquedaAplicada, setBusquedaAplicada] = useState("");
  const [pagina, setPagina] = useState(1);
  /** Se incrementa para volver a consultar con los mismos filtros. */
  const [version, setVersion] = useState(0);
  const [respuesta, setRespuesta] = useState<Respuesta | null>(null);
  const [aviso, setAviso] = useState("");

  const [formulario, setFormulario] = useState<Formulario | null>(null);
  const [porEliminar, setPorEliminar] = useState<ClienteDescuento | null>(null);
  const [eliminando, setEliminando] = useState(false);
  const [errorEliminar, setErrorEliminar] = useState("");

  const [importando, setImportando] = useState(false);
  const [resumenImportacion, setResumenImportacion] = useState<ResumenImportacion | null>(null);
  const [errorImportacion, setErrorImportacion] = useState("");
  const archivoRef = useRef<HTMLInputElement>(null);

  const clave = `${version}|${pagina}|${busquedaAplicada}`;

  // La búsqueda se aplica cuando el usuario deja de teclear.
  useEffect(() => {
    const temporizador = setTimeout(() => {
      setBusquedaAplicada(busqueda.trim());
      setPagina(1);
    }, ESPERA_BUSQUEDA_MS);
    return () => clearTimeout(temporizador);
  }, [busqueda]);

  useEffect(() => {
    if (!aviso) return;
    const temporizador = setTimeout(() => setAviso(""), AVISO_MS);
    return () => clearTimeout(temporizador);
  }, [aviso]);

  // Consulta del padrón: una por clave (filtros + versión); la respuesta de
  // una consulta vieja que llegue tarde se descarta.
  useEffect(() => {
    let cancelado = false;
    const parametros = new URLSearchParams({ pagina: String(pagina) });
    if (busquedaAplicada) parametros.set("busqueda", busquedaAplicada);

    (async () => {
      try {
        const res = await fetch(`/api/clientes-descuento?${parametros}`);
        if (res.status === 401) {
          router.push("/login");
          return;
        }
        const cuerpo = (await res.json().catch(() => null)) as
          | (PaginaClientesDescuento & { error?: string })
          | null;
        if (!res.ok || !cuerpo || cuerpo.error) {
          throw new Error(cuerpo?.error ?? "No se pudo consultar el padrón");
        }
        if (cancelado) return;
        // Página fuera de rango (p. ej. se borró el último registro de la
        // última página): se salta a la última que sí tiene registros.
        if (cuerpo.registros.length === 0 && cuerpo.total > 0 && pagina > 1) {
          setPagina(Math.max(1, Math.ceil(cuerpo.total / cuerpo.porPagina)));
          return;
        }
        setRespuesta({ clave, datos: cuerpo, error: "" });
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
  }, [clave, pagina, busquedaAplicada, router]);

  const cargando = respuesta?.clave !== clave;
  // Mientras llega la consulta nueva se sigue mostrando la anterior.
  const datos = respuesta?.datos ?? null;
  const error = respuesta?.clave === clave ? respuesta.error : "";

  const recargar = () => setVersion((v) => v + 1);
  const cerrarFormulario = useCallback(() => setFormulario(null), []);
  const cerrarBaja = useCallback(() => {
    if (!eliminando) setPorEliminar(null);
  }, [eliminando]);

  const alGuardar = (registro: ClienteDescuento, modo: ModoFormulario) => {
    setFormulario(null);
    setAviso(
      modo === "alta"
        ? `Se dio de alta a ${registro.cliente} con ${porcentaje(registro.descuento)}`
        : `Se guardaron los cambios de ${registro.cliente}`
    );
    recargar();
  };

  const eliminar = async () => {
    if (!porEliminar) return;
    setEliminando(true);
    setErrorEliminar("");
    try {
      const res = await fetch(`/api/clientes-descuento/${porEliminar.id}`, { method: "DELETE" });
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      const cuerpo = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok || cuerpo?.error) throw new Error(cuerpo?.error ?? "No se pudo eliminar");
      setAviso(`Se eliminó a ${porEliminar.cliente}`);
      setPorEliminar(null);
      recargar();
    } catch (err: unknown) {
      setErrorEliminar(err instanceof Error ? err.message : "Error al eliminar");
    } finally {
      setEliminando(false);
    }
  };

  /** Sube el CSV de la lista APV y muestra el resumen de lo que entró. */
  const importar = async (archivo: File) => {
    setImportando(true);
    setErrorImportacion("");
    setResumenImportacion(null);
    try {
      const cuerpoPeticion = new FormData();
      cuerpoPeticion.append("archivo", archivo);
      const res = await fetch("/api/clientes-descuento/importar", {
        method: "POST",
        body: cuerpoPeticion,
      });
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      const cuerpo = (await res.json().catch(() => null)) as
        | (ResumenImportacion & { error?: string })
        | null;
      if (!res.ok || !cuerpo || cuerpo.error) {
        throw new Error(cuerpo?.error ?? "No se pudo importar la lista");
      }
      setResumenImportacion(cuerpo);
      recargar();
    } catch (err: unknown) {
      setErrorImportacion(err instanceof Error ? err.message : "Error al importar");
    } finally {
      setImportando(false);
      // Permite volver a elegir el mismo archivo.
      if (archivoRef.current) archivoRef.current.value = "";
    }
  };

  const totalPaginas = datos ? Math.max(1, Math.ceil(datos.total / datos.porPagina)) : 1;

  const tarjetas = datos
    ? [
        { titulo: "Clientes registrados", valor: entero(datos.total), color: "text-slate-200" },
        { titulo: "Altas este mes", valor: entero(datos.altasMes), color: "text-emerald-300" },
        {
          titulo: "Descuento promedio",
          valor: porcentaje(datos.descuentoPromedio),
          color: "text-amber-300",
        },
        {
          titulo: "Descuento por defecto",
          valor: porcentaje(datos.descuentoDefault),
          color: "text-cyan-300",
        },
      ]
    : [];

  return (
    <div className="space-y-4">
      {/* Encabezado */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight">Clientes con descuento</h1>
          <p className={cn(lbl, "mt-1")}>
            {cargando
              ? "Consultando..."
              : datos
                ? `${entero(datos.total)} clientes en el padrón del Vendedor IA`
                : "Sin datos"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={recargar} disabled={cargando} className={btnSecundario}>
            {cargando ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Actualizar
          </button>
          <input
            ref={archivoRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const archivo = e.target.files?.[0];
              if (archivo) void importar(archivo);
            }}
          />
          <button
            onClick={() => archivoRef.current?.click()}
            disabled={importando}
            title="Cargar la lista de clientes APV (CSV)"
            className={btnSecundario}
          >
            {importando ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="h-3.5 w-3.5" />
            )}
            Importar CSV
          </button>
          <button
            onClick={() => setFormulario({ modo: "alta" })}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500 text-slate-950 text-[11px] font-black uppercase tracking-widest hover:brightness-110 transition-all"
          >
            <Plus className="h-3.5 w-3.5" />
            Nuevo cliente
          </button>
        </div>
      </div>

      {/* Búsqueda */}
      <div className="bg-white/[0.02] border border-white/10 rounded-2xl p-4">
        <label htmlFor="cd-busqueda" className={lbl}>
          Buscar
        </label>
        <div className="relative mt-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-600" />
          <input
            id="cd-busqueda"
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Celular, nombre, RFC o email…"
            className={cn(inputCls, "pl-9")}
          />
        </div>
      </div>

      {/* Tarjetas */}
      {datos && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {tarjetas.map((t) => (
            <div key={t.titulo} className="bg-white/[0.02] border border-white/10 rounded-2xl p-4">
              <p className={lbl}>{t.titulo}</p>
              <p className={cn("text-2xl font-black mt-1 tabular-nums", t.color)}>{t.valor}</p>
            </div>
          ))}
        </div>
      )}

      {aviso && (
        <div
          role="status"
          className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/25 rounded-2xl p-4 text-emerald-300 text-sm font-bold"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          {aviso}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 bg-rose-500/10 border border-rose-500/25 rounded-2xl p-4 text-rose-300 text-sm font-bold">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {errorImportacion && (
        <div className="flex items-center gap-2 bg-rose-500/10 border border-rose-500/25 rounded-2xl p-4 text-rose-300 text-sm font-bold">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {errorImportacion}
        </div>
      )}

      {resumenImportacion && (
        <ResumenDeImportacion
          resumen={resumenImportacion}
          onCerrar={() => setResumenImportacion(null)}
        />
      )}

      {/* Tabla */}
      <div className="bg-white/[0.02] border border-white/10 rounded-2xl overflow-hidden">
        {cargando && !datos ? (
          <div className="flex items-center justify-center gap-2 p-10 text-slate-400 text-sm font-bold">
            <Loader2 className="h-4 w-4 animate-spin" />
            Consultando el padrón…
          </div>
        ) : !datos ? (
          <div className="p-10 text-center text-slate-500 text-sm font-bold">
            No se pudo mostrar el padrón.
          </div>
        ) : datos.registros.length === 0 ? (
          <div className="p-10 text-center text-slate-500 text-sm font-bold">
            {busquedaAplicada
              ? "Ningún cliente coincide con la búsqueda."
              : "Todavía no hay clientes con descuento. Da de alta el primero."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-[#10151f] shadow-[0_1px_0_rgba(255,255,255,0.08)]">
                <tr>
                  <th className={cn(lbl, "px-4 py-2.5 text-left")}>Celular</th>
                  <th className={cn(lbl, "px-4 py-2.5 text-left")}>Cliente</th>
                  <th className={cn(lbl, "px-4 py-2.5 text-left")}>Otros teléfonos</th>
                  <th className={cn(lbl, "px-4 py-2.5 text-left")}>Email</th>
                  <th className={cn(lbl, "px-4 py-2.5 text-right")}>Descuento</th>
                  <th className={cn(lbl, "px-4 py-2.5 text-left")}>Fecha de alta</th>
                  <th className={cn(lbl, "px-4 py-2.5 text-left")}>Capturó</th>
                  <th className={cn(lbl, "px-4 py-2.5 text-right")}>
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {datos.registros.map((r) => (
                  <tr key={r.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-4 py-2.5 font-mono text-[13px] font-bold text-slate-100 tabular-nums whitespace-nowrap">
                      {r.telefono ?? (
                        <span className="font-sans text-slate-600" title="Sin celular: WhatsApp no lo identifica">
                          —
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-[12px] font-black text-slate-200 max-w-[320px]">
                      <div className="truncate">
                        {r.cliente}
                        {r.idClienteBdav != null && (
                          <span
                            className="ml-2 text-[9px] font-black uppercase tracking-widest text-slate-500"
                            title={`Cliente #${r.idClienteBdav} del catálogo de bdav`}
                          >
                            catálogo
                          </span>
                        )}
                      </div>
                      {r.rfc && (
                        <div className="font-mono text-[10px] font-bold tracking-wide text-slate-500">
                          {r.rfc}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400 max-w-[200px] truncate">
                      {r.telefono2 ?? <span className="text-slate-600">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400 max-w-[220px] truncate">
                      {r.email ?? <span className="text-slate-600">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span
                        className={cn(
                          "inline-block text-[11px] font-black tabular-nums px-2 py-1 rounded-lg border",
                          datos.descuentoDefault > 0 && r.descuento >= datos.descuentoDefault
                            ? "text-amber-300 bg-amber-500/10 border-amber-500/25"
                            : "text-slate-300 bg-white/[0.04] border-white/10"
                        )}
                      >
                        {porcentaje(r.descuento)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400 tabular-nums whitespace-nowrap">
                      {fechaCorta(r.creadoEn)} · {hora(r.creadoEn)}
                    </td>
                    <td className="px-4 py-2.5 text-[12px] font-bold text-slate-500 max-w-[140px] truncate">
                      {r.creadoPor ?? "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setFormulario({ modo: "edicion", registro: r })}
                          aria-label={`Editar a ${r.cliente}`}
                          title="Editar"
                          className={cn(btnIcono, "hover:text-amber-300")}
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => {
                            setErrorEliminar("");
                            setPorEliminar(r);
                          }}
                          aria-label={`Eliminar a ${r.cliente}`}
                          title="Eliminar"
                          className={cn(btnIcono, "hover:text-rose-300")}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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

      {/* Alta / edición */}
      {formulario && (
        <FormularioClienteDescuento
          key={formulario.modo === "edicion" ? `edicion-${formulario.registro.id}` : "alta"}
          modo={formulario.modo}
          registro={formulario.modo === "edicion" ? formulario.registro : undefined}
          onCerrar={cerrarFormulario}
          onGuardado={alGuardar}
          onEditarExistente={(registro) => setFormulario({ modo: "edicion", registro })}
        />
      )}

      {/* Confirmación de baja */}
      {porEliminar && (
        <DialogoBaja
          registro={porEliminar}
          eliminando={eliminando}
          error={errorEliminar}
          onCerrar={cerrarBaja}
          onConfirmar={() => void eliminar()}
        />
      )}
    </div>
  );
}

function DialogoBaja({
  registro,
  eliminando,
  error,
  onCerrar,
  onConfirmar,
}: {
  registro: ClienteDescuento;
  eliminando: boolean;
  error: string;
  onCerrar: () => void;
  onConfirmar: () => void;
}) {
  const dialogoRef = useRef<HTMLDivElement>(null);
  // El foco entra en "Cancelar": Enter por reflejo no borra nada.
  const cancelarRef = useRef<HTMLButtonElement>(null);
  useDialogo(dialogoRef, onCerrar, cancelarRef);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onCerrar}
    >
      <div
        ref={dialogoRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="cd-eliminar-titulo"
        aria-describedby="cd-eliminar-texto"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-[#0a101c] border border-white/10 rounded-2xl shadow-2xl shadow-black/60"
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/10">
          <h2 id="cd-eliminar-titulo" className="text-base font-black text-white">
            Eliminar cliente con descuento
          </h2>
          <button
            onClick={onCerrar}
            disabled={eliminando}
            aria-label="Cerrar"
            className="ml-auto p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/[0.06] transition-all disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <p id="cd-eliminar-texto" className="text-sm text-slate-300 leading-relaxed">
            Se quitará del padrón a <b className="text-white">{registro.cliente}</b> (
            <span className="font-mono tabular-nums">{registro.telefono ?? "sin celular"}</span>,{" "}
            {porcentaje(registro.descuento)}). Esta acción no se puede deshacer.
          </p>
          {error && (
            <div className="flex items-center gap-2 bg-rose-500/10 border border-rose-500/25 rounded-xl p-3 text-rose-300 text-sm font-bold">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-white/10">
          <button
            ref={cancelarRef}
            onClick={onCerrar}
            disabled={eliminando}
            className={btnSecundario}
          >
            Cancelar
          </button>
          <button
            onClick={onConfirmar}
            disabled={eliminando}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-rose-500 text-white text-[11px] font-black uppercase tracking-widest hover:brightness-110 transition-all disabled:opacity-40"
          >
            {eliminando ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
            Eliminar
          </button>
        </div>
      </div>
    </div>
  );
}

/** Lo que se muestra de cada lista de incidencias antes de "y N más". */
const INCIDENCIAS_VISIBLES = 40;

function ListaIncidencias({ titulo, lineas }: { titulo: string; lineas: string[] }) {
  if (lineas.length === 0) return null;
  const visibles = lineas.slice(0, INCIDENCIAS_VISIBLES);
  return (
    <details className="text-[12px]">
      <summary className="cursor-pointer font-black text-cyan-200/90 hover:text-white">
        {titulo} ({entero(lineas.length)})
      </summary>
      <ul className="mt-2 max-h-56 overflow-y-auto space-y-0.5 pl-4 list-disc text-cyan-100/80">
        {visibles.map((linea, i) => (
          <li key={i}>{linea}</li>
        ))}
        {lineas.length > visibles.length && (
          <li className="list-none text-cyan-200/60">
            … y {entero(lineas.length - visibles.length)} más
          </li>
        )}
      </ul>
    </details>
  );
}

function ResumenDeImportacion({
  resumen,
  onCerrar,
}: {
  resumen: ResumenImportacion;
  onCerrar: () => void;
}) {
  return (
    <div
      role="status"
      className="bg-cyan-500/10 border border-cyan-500/25 rounded-2xl p-4 text-sm text-cyan-100 space-y-3"
    >
      <div className="flex items-start gap-3">
        <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-cyan-300" />
        <p className="font-bold leading-relaxed">
          Lista importada: {entero(resumen.insertados)} clientes nuevos y{" "}
          {entero(resumen.actualizados)} actualizados de {entero(resumen.total)}.{" "}
          {entero(resumen.sinCelular)} quedaron sin celular (WhatsApp no los identifica hasta
          que se les capture uno) y {entero(resumen.ligadosBdav)} se ligaron al catálogo de bdav
          por su RFC.
        </p>
        <button
          onClick={onCerrar}
          aria-label="Cerrar"
          className="ml-auto p-1.5 rounded-lg text-cyan-200/70 hover:text-white hover:bg-white/[0.06] transition-all"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <ListaIncidencias
        titulo="Celulares que ya eran de otro cliente: entraron sin celular, revisa a quién pertenece"
        lineas={resumen.celularRepetido.map(
          (c) => `Línea ${c.linea} · ID ${c.idClienteApv} ${c.cliente}: ${c.telefono} ya es de ${c.asignadoA}`
        )}
      />
      <ListaIncidencias
        titulo="Filas que no entraron"
        lineas={resumen.omitidas.map((o) => `Línea ${o.linea}: ${o.motivo}`)}
      />
      <ListaIncidencias
        titulo="Filas que entraron con algún dato movido"
        lineas={resumen.advertencias.map((a) => `Línea ${a.linea}: ${a.motivo}`)}
      />
    </div>
  );
}
