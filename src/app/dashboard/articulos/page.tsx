"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  FileText,
  ListRestart,
  Loader2,
  Package,
  PackageCheck,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { moneda, entero, fechaCorta, hoyISO, conIva } from "@/lib/formato";
import { FotoArticulo } from "@/components/dashboard/FotoArticulo";

// ---------- Tipos ----------
interface Articulo {
  id: number;
  codigo: string;
  descripcion: string;
  linea: string;
  parte: string;
  aini: string | number | null;
  afin: string | number | null;
  precioLista: number;
  precioVta: number;
  existencia: number;
  localizacion: string | null;
}

interface Resumen {
  codigos: number;
  codigosConExistencia: number;
  piezas: number;
  valorLista: number;
}

interface PrecioAldo {
  encontrado: boolean;
  descripcion?: string;
  sinIva?: number;
  conIva?: number;
  existencia?: number | string;
}

interface OpcionLinea {
  id: number;
  linea: string;
}

interface OpcionParte {
  id: number;
  parte: string;
}

interface DetalleArticulo {
  articulo: {
    id: number;
    codigo: string;
    descripcion: string;
    linea: string;
    parte: string;
    proveedor: string;
    precioLista: number;
    precioCpa: number;
    descuento: number;
    precioVta: number;
    utilidad: number;
    existencia: number;
    minimo: number;
    maximo: number;
    reorden: number;
    localizacion: string | null;
    aini: string | number | null;
    afin: string | number | null;
  };
  aplicaciones: {
    modelo: string;
    aini: string | number | null;
    afin: string | number | null;
  }[];
  codigosAlternos: { codigo: string | null; codigoAlterno: string }[];
  ultimosMovimientos: {
    fecha: string;
    tipoMov: string | null;
    tipoDoc: string | null;
    numDoc: number | null;
    existAnt: number;
    cantidad: number;
    existPost: number;
    usuario: string;
  }[];
}

// ---------- Constantes de estilo (patrón kyk-server-web) ----------
const lbl = "text-[10px] font-black text-slate-500 uppercase tracking-widest";
const inputCls =
  "block w-full px-4 py-2.5 bg-white/[0.03] border border-white/10 rounded-xl text-sm font-bold text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-400/25 focus:border-amber-400/60 transition-all";

const PAGE_SIZE = 50;

/** '2001'/'2006' → '01-06'; otros formatos se muestran tal cual (aini-afin). */
const rangoAnios = (
  aini: string | number | null,
  afin: string | number | null
): string => {
  const corto = (v: string | number | null) => {
    const s = v == null ? "" : String(v).trim();
    return /^\d{4}$/.test(s) ? s.slice(-2) : s;
  };
  const i = corto(aini);
  const f = corto(afin);
  if (!i && !f) return "—";
  return `${i}-${f}`;
};

/** Badge de tipo de movimiento: VENTA emerald, DEVOLUCION rose, resto informativo. */
const claseTipoMov = (tipo: string | null): string => {
  if (tipo === "VENTA") return "text-emerald-300 bg-emerald-500/10 border-emerald-500/25";
  if (tipo === "DEVOLUCION") return "text-rose-300 bg-rose-500/10 border-rose-500/25";
  return "text-cyan-300 bg-cyan-500/10 border-cyan-500/25";
};

export default function ArticulosPage() {
  const [busqueda, setBusqueda] = useState("");
  const [idLinea, setIdLinea] = useState("");
  const [idParte, setIdParte] = useState("");
  const [soloExistencia, setSoloExistencia] = useState(false);
  const [page, setPage] = useState(1);

  const [lineas, setLineas] = useState<OpcionLinea[]>([]);
  const [partes, setPartes] = useState<OpcionParte[]>([]);

  const [articulos, setArticulos] = useState<Articulo[]>([]);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [exportando, setExportando] = useState<"pdf" | "excel" | null>(null);

  const [detalle, setDetalle] = useState<DetalleArticulo | null>(null);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);

  // Precio de Aldo Autopartes para el artículo abierto en el detalle.
  const [aldo, setAldo] = useState<PrecioAldo | null>(null);
  const [cargandoAldo, setCargandoAldo] = useState(false);

  // Precios de Aldo por código para las filas de la tabla (carga progresiva).
  // undefined = aún cargando; objeto = ya resuelto (encontrado o no).
  const [preciosAldo, setPreciosAldo] = useState<Record<string, PrecioAldo>>({});

  // Token de secuencia: descarta respuestas viejas que lleguen tras una petición más nueva.
  const peticionRef = useRef(0);
  // Token propio para la carga de precios Aldo de la tabla.
  const aldoTablaRef = useRef(0);

  const cargar = useCallback(
    async (
      filtro: string,
      linea: string,
      parte: string,
      existencia: boolean,
      pagina: number
    ) => {
      const idPeticion = ++peticionRef.current;
      setCargando(true);
      setError("");
      try {
        const qs = new URLSearchParams({
          page: String(pagina),
          pageSize: String(PAGE_SIZE),
        });
        if (filtro) qs.set("busqueda", filtro);
        if (linea) qs.set("idLinea", linea);
        if (parte) qs.set("idParte", parte);
        if (existencia) qs.set("conExistencia", "1");
        const res = await fetch(`/api/articulos?${qs.toString()}`);
        // Otra petición más nueva empezó: descarta esta respuesta sin tocar estado.
        if (idPeticion !== peticionRef.current) return;
        if (res.status === 401) {
          window.location.href = "/login";
          return;
        }
        const json = await res.json();
        if (idPeticion !== peticionRef.current) return;
        if (!res.ok) throw new Error(json.error || "Error al consultar artículos");
        setArticulos(json.articulos);
        setResumen(json.resumen);
        setTotal(json.total);
      } catch (err: unknown) {
        // No escribas el error de una petición obsoleta.
        if (idPeticion !== peticionRef.current) return;
        setError(err instanceof Error ? err.message : "Error desconocido");
        setArticulos([]);
        setResumen(null);
        setTotal(0);
      } finally {
        // Solo la petición vigente apaga el spinner.
        if (idPeticion === peticionRef.current) setCargando(false);
      }
    },
    []
  );

  useEffect(() => {
    // Los catálogos alimentan los selects; si fallan, el listado sigue operando
    // con los selects vacíos (por eso no se bloquea la página con el error).
    const cargarCatalogos = async () => {
      try {
        const res = await fetch("/api/articulos/catalogos");
        if (res.status === 401) {
          window.location.href = "/login";
          return;
        }
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Error al consultar catálogos");
        setLineas(json.lineas);
        setPartes(json.partes);
      } catch {
        setLineas([]);
        setPartes([]);
      }
    };
    cargarCatalogos();
    cargar("", "", "", false, 1);
  }, [cargar]);

  // Al cambiar la página de artículos, trae los precios de Aldo de esos códigos
  // de forma progresiva (varios trabajadores en paralelo, con tope), para no
  // saturar el sitio de Aldo. Cada fila se va llenando conforme llega su precio.
  useEffect(() => {
    if (articulos.length === 0) {
      setPreciosAldo({});
      return;
    }
    const idCarga = ++aldoTablaRef.current;
    setPreciosAldo({});
    const codigos = articulos.map((a) => a.codigo);
    let siguiente = 0;
    const TRABAJADORES = 5;

    const trabajar = async () => {
      while (siguiente < codigos.length) {
        const codigo = codigos[siguiente++];
        let datos: PrecioAldo;
        try {
          const res = await fetch(
            `/api/articulos/precio-aldo?codigo=${encodeURIComponent(codigo)}`
          );
          datos = res.ok ? await res.json() : { encontrado: false };
        } catch {
          datos = { encontrado: false };
        }
        // Si el usuario cambió de página/filtro, descarta este resultado.
        if (idCarga !== aldoTablaRef.current) return;
        setPreciosAldo((prev) => ({ ...prev, [codigo]: datos }));
      }
    };

    // Lanza los trabajadores; sus errores no deben romper la página.
    void Promise.all(Array.from({ length: TRABAJADORES }, trabajar));
  }, [articulos]);

  const actualizar = () => {
    setPage(1);
    cargar(busqueda, idLinea, idParte, soloExistencia, 1);
  };

  const alternarExistencia = () => {
    const valor = !soloExistencia;
    setSoloExistencia(valor);
    setPage(1);
    cargar(busqueda, idLinea, idParte, valor, 1);
  };

  const limpiar = () => {
    setBusqueda("");
    setIdLinea("");
    setIdParte("");
    setSoloExistencia(false);
    setPage(1);
    cargar("", "", "", false, 1);
  };

  const cambiarPagina = (pagina: number) => {
    setPage(pagina);
    cargar(busqueda, idLinea, idParte, soloExistencia, pagina);
  };

  const verDetalle = async (articulo: Articulo) => {
    setCargandoDetalle(true);
    setAldo(null);
    try {
      const res = await fetch(`/api/articulos/${articulo.id}`);
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error al consultar el detalle");
      setDetalle(json);
      // El precio de Aldo se consulta aparte (scraping de su catálogo): no debe
      // bloquear ni romper la apertura del detalle si su sitio no responde.
      setCargandoAldo(true);
      fetch(`/api/articulos/precio-aldo?codigo=${encodeURIComponent(articulo.codigo)}`)
        .then((r) => (r.ok ? r.json() : { encontrado: false }))
        .then((datos: PrecioAldo) => setAldo(datos))
        .catch(() => setAldo({ encontrado: false }))
        .finally(() => setCargandoAldo(false));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setCargandoDetalle(false);
    }
  };

  const exportar = async (formato: "pdf" | "excel") => {
    setExportando(formato);
    setError("");
    try {
      // Trae el catálogo filtrado completo (hasta el tope del servidor).
      const qs = new URLSearchParams({ page: "1", pageSize: "20000" });
      if (busqueda) qs.set("busqueda", busqueda);
      if (idLinea) qs.set("idLinea", idLinea);
      if (idParte) qs.set("idParte", idParte);
      if (soloExistencia) qs.set("conExistencia", "1");
      const res = await fetch(`/api/articulos?${qs.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error al exportar");
      const filas: Articulo[] = json.articulos;

      const nombreLinea = lineas.find((l) => String(l.id) === idLinea)?.linea;
      const nombreParte = partes.find((p) => String(p.id) === idParte)?.parte;
      const columnas = [
        { header: "Código" },
        { header: "Descripción" },
        { header: "Línea" },
        { header: "Parte" },
        { header: "Años" },
        { header: "P. Lista", align: "right" as const },
        { header: "Sin IVA", align: "right" as const },
        { header: "Con IVA", align: "right" as const },
        { header: "Existencia", align: "right" as const },
        { header: "Localización" },
      ];
      const base = {
        titulo: "CATÁLOGO DE ARTÍCULOS",
        subtitulo: `${nombreLinea ? `Línea ${nombreLinea}  ·  ` : ""}${
          nombreParte ? `Parte ${nombreParte}  ·  ` : ""
        }${soloExistencia ? "Solo con existencia  ·  " : ""}${
          busqueda ? `Búsqueda "${busqueda}"  ·  ` : ""
        }${entero(filas.length)} códigos`,
        columnas,
        nombreArchivo: `articulos_${hoyISO()}`,
      };

      if (formato === "pdf") {
        const { exportarPdf } = await import("@/lib/export");
        await exportarPdf({
          ...base,
          orientacion: "landscape",
          filas: filas.map((a) => [
            a.codigo,
            a.descripcion,
            a.linea,
            a.parte,
            rangoAnios(a.aini, a.afin),
            moneda(a.precioLista),
            moneda(a.precioVta),
            moneda(conIva(a.precioVta)),
            entero(a.existencia),
            a.localizacion ?? "",
          ]),
        });
      } else {
        const { exportarExcel } = await import("@/lib/export");
        await exportarExcel({
          ...base,
          hoja: "Artículos",
          columnasMoneda: [5, 6, 7],
          filas: filas.map((a) => [
            a.codigo,
            a.descripcion,
            a.linea,
            a.parte,
            rangoAnios(a.aini, a.afin),
            a.precioLista,
            a.precioVta,
            conIva(a.precioVta),
            a.existencia,
            a.localizacion ?? "",
          ]),
        });
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error al exportar");
    } finally {
      setExportando(null);
    }
  };

  const totalPaginas = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Existencia de Aldo: número exacto formateado, o etiqueta ("Mas de 60") tal cual.
  const existenciaAldoTexto = (v: number | string | undefined): string => {
    if (v == null) return "—";
    return typeof v === "number" ? entero(v) : v;
  };

  // Contenido de una celda del grupo Aldo según el estado de carga de su código.
  const celdaAldo = (codigo: string, render: (a: PrecioAldo) => React.ReactNode) => {
    const dato = preciosAldo[codigo];
    if (dato === undefined) {
      return <Loader2 className="h-3 w-3 animate-spin text-cyan-400/50 inline-block" />;
    }
    if (!dato.encontrado) return <span className="text-slate-600">—</span>;
    return render(dato);
  };

  const tarjetas = resumen
    ? [
        { titulo: "Códigos", valor: entero(resumen.codigos), color: "text-slate-200" },
        {
          titulo: "Con existencia",
          valor: entero(resumen.codigosConExistencia),
          color: "text-emerald-300",
        },
        { titulo: "Piezas", valor: entero(resumen.piezas), color: "text-cyan-300" },
        {
          titulo: "Valor a precio de lista",
          valor: moneda(resumen.valorLista),
          color: "text-amber-300",
        },
      ]
    : [];

  return (
    <div className="space-y-4">
      {/* Encabezado */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight">Artículos</h1>
          <p className={cn(lbl, "mt-1")}>
            {cargando ? "Consultando..." : `${entero(total)} códigos en el catálogo`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => exportar("pdf")}
            disabled={!!exportando || cargando || articulos.length === 0}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/[0.05] border border-white/10 text-slate-300 text-[11px] font-black uppercase tracking-widest hover:text-rose-300 transition-all disabled:opacity-40"
          >
            {exportando === "pdf" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FileText className="h-3.5 w-3.5" />
            )}
            PDF
          </button>
          <button
            onClick={() => exportar("excel")}
            disabled={!!exportando || cargando || articulos.length === 0}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/[0.05] border border-white/10 text-slate-300 text-[11px] font-black uppercase tracking-widest hover:text-emerald-300 transition-all disabled:opacity-40"
          >
            {exportando === "excel" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FileSpreadsheet className="h-3.5 w-3.5" />
            )}
            Excel
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-4 backdrop-blur-xl space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="relative flex-1 min-w-[260px] space-y-1.5">
            <label className={lbl}>Buscar</label>
            <div className="relative">
              <Search className="absolute top-1/2 -translate-y-1/2 left-3.5 h-4 w-4 text-slate-500" />
              <input
                type="text"
                className={cn(inputCls, "pl-10")}
                placeholder="Código, descripción o código alterno..."
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && actualizar()}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className={lbl}>Línea</label>
            <select
              className={cn(inputCls, "w-48 appearance-none [color-scheme:dark]")}
              value={idLinea}
              onChange={(e) => setIdLinea(e.target.value)}
            >
              <option value="" className="bg-[#0d1320]">Todas</option>
              {lineas.map((l) => (
                <option key={l.id} value={l.id} className="bg-[#0d1320]">
                  {l.linea}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className={lbl}>Parte</label>
            <select
              className={cn(inputCls, "w-48 appearance-none [color-scheme:dark]")}
              value={idParte}
              onChange={(e) => setIdParte(e.target.value)}
            >
              <option value="" className="bg-[#0d1320]">Todas</option>
              {partes.map((p) => (
                <option key={p.id} value={p.id} className="bg-[#0d1320]">
                  {p.parte}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={alternarExistencia}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 rounded-xl border text-[11px] font-black uppercase tracking-widest transition-all",
              soloExistencia
                ? "bg-amber-500/15 border-amber-500/40 text-amber-300"
                : "bg-white/[0.05] border-white/10 text-slate-400 hover:text-amber-300"
            )}
          >
            <PackageCheck className="h-3.5 w-3.5" /> Solo con existencia
          </button>
          <button
            onClick={actualizar}
            disabled={cargando}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500 text-slate-950 text-[11px] font-black uppercase tracking-widest hover:brightness-110 transition-all disabled:opacity-40"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", cargando && "animate-spin")} /> Actualizar
          </button>
          <button
            onClick={limpiar}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/[0.05] border border-white/10 text-slate-400 text-[11px] font-black uppercase tracking-widest hover:text-white transition-all"
          >
            <ListRestart className="h-3.5 w-3.5" /> Limpiar
          </button>
        </div>
      </div>

      {/* Tarjetas de resumen */}
      {resumen && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {tarjetas.map((t) => (
            <div
              key={t.titulo}
              className="bg-white/[0.04] border border-white/10 rounded-2xl p-4 backdrop-blur-xl"
            >
              <p className={lbl}>{t.titulo}</p>
              <p className={cn("text-xl font-black mt-2 truncate", t.color)}>{t.valor}</p>
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 text-rose-300 text-[11px] font-black bg-rose-500/10 p-3 rounded-xl border border-rose-500/25 uppercase tracking-wider">
          <AlertTriangle className="h-4 w-4" /> {error}
        </div>
      )}

      {/* Tabla */}
      <div className="bg-white/[0.04] border border-white/10 rounded-2xl backdrop-blur-xl overflow-hidden">
        {cargando ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-8 w-8 text-amber-400 animate-spin" />
          </div>
        ) : articulos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3 text-slate-500">
            <Package className="h-10 w-10" />
            <p className="text-[11px] font-black uppercase tracking-widest">
              Sin artículos con los filtros seleccionados
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-auto max-h-[calc(100vh-24rem)]">
              <table className="w-full">
                <thead className="sticky top-0 z-10 bg-[#10151f] shadow-[0_1px_0_rgba(255,255,255,0.08)]">
                  {/* Fila 1: columnas de contexto + los dos grupos */}
                  <tr>
                    <th rowSpan={2} className={cn(lbl, "px-4 py-2 text-center")}>Foto</th>
                    <th rowSpan={2} className={cn(lbl, "px-4 py-2 text-left")}>Código</th>
                    <th rowSpan={2} className={cn(lbl, "px-4 py-2 text-left")}>Descripción</th>
                    <th rowSpan={2} className={cn(lbl, "px-4 py-2 text-left")}>Línea</th>
                    <th rowSpan={2} className={cn(lbl, "px-4 py-2 text-left")}>Parte</th>
                    <th rowSpan={2} className={cn(lbl, "px-4 py-2 text-center")}>Años</th>
                    <th
                      colSpan={4}
                      className="px-4 pt-2 pb-1 text-center text-[10px] font-black text-amber-300 uppercase tracking-widest border-l border-amber-500/25 bg-amber-500/[0.06]"
                    >
                      Vidaurri
                    </th>
                    <th
                      colSpan={3}
                      className="px-4 pt-2 pb-1 text-center text-[10px] font-black text-cyan-300 uppercase tracking-widest border-l border-cyan-500/25 bg-cyan-500/[0.06]"
                    >
                      Aldo Autopartes
                    </th>
                  </tr>
                  {/* Fila 2: subcolumnas de cada grupo */}
                  <tr>
                    <th className={cn(lbl, "px-4 py-2 text-right border-l border-amber-500/25")}>P. Lista</th>
                    <th className={cn(lbl, "px-4 py-2 text-right")}>Sin IVA</th>
                    <th className={cn(lbl, "px-4 py-2 text-right")}>Con IVA</th>
                    <th className={cn(lbl, "px-4 py-2 text-right")}>Exist.</th>
                    <th className={cn(lbl, "px-4 py-2 text-right border-l border-cyan-500/25")}>Sin IVA</th>
                    <th className={cn(lbl, "px-4 py-2 text-right")}>Con IVA</th>
                    <th className={cn(lbl, "px-4 py-2 text-right")}>Exist.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {articulos.map((a) => (
                    <tr
                      key={a.id}
                      onClick={() => verDetalle(a)}
                      className="cursor-pointer transition-colors hover:bg-white/[0.03]"
                    >
                      <td className="px-4 py-2 text-center">
                        <FotoArticulo
                          codigo={a.codigo}
                          thumb
                          className="h-10 w-10 rounded-lg mx-auto"
                        />
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-black text-amber-300">
                        {a.codigo}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-bold text-slate-300 max-w-[280px] truncate">
                        {a.descripcion}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400">
                        {a.linea}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400">
                        {a.parte}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400 text-center">
                        {rangoAnios(a.aini, a.afin)}
                      </td>

                      {/* Grupo Vidaurri */}
                      <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400 text-right border-l border-amber-500/15">
                        {moneda(a.precioLista)}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-bold text-slate-300 text-right">
                        {moneda(a.precioVta)}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-black text-amber-300 text-right">
                        {moneda(conIva(a.precioVta))}
                      </td>
                      <td
                        className={cn(
                          "px-4 py-2.5 text-[12px] font-black text-right",
                          a.existencia > 0
                            ? "text-emerald-300"
                            : a.existencia < 0
                              ? "text-rose-300"
                              : "text-slate-500"
                        )}
                      >
                        {entero(a.existencia)}
                      </td>

                      {/* Grupo Aldo Autopartes */}
                      <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400 text-right border-l border-cyan-500/15">
                        {celdaAldo(a.codigo, (al) => moneda(al.sinIva))}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-black text-cyan-300 text-right">
                        {celdaAldo(a.codigo, (al) => moneda(al.conIva))}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-black text-slate-300 text-right">
                        {celdaAldo(a.codigo, (al) => existenciaAldoTexto(al.existencia))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Paginación */}
            {total > PAGE_SIZE && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-white/[0.06]">
                <button
                  onClick={() => cambiarPagina(page - 1)}
                  disabled={page <= 1 || cargando}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/[0.05] border border-white/10 text-slate-300 text-[11px] font-black uppercase tracking-widest disabled:opacity-40 hover:text-amber-300 transition-all"
                >
                  <ChevronLeft className="h-3.5 w-3.5" /> Anterior
                </button>
                <span className={lbl}>
                  Página {entero(page)} de {entero(totalPaginas)}
                </span>
                <button
                  onClick={() => cambiarPagina(page + 1)}
                  disabled={page >= totalPaginas || cargando}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/[0.05] border border-white/10 text-slate-300 text-[11px] font-black uppercase tracking-widest disabled:opacity-40 hover:text-amber-300 transition-all"
                >
                  Siguiente <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Overlay de carga del detalle */}
      {cargandoDetalle && (
        <div className="fixed inset-0 z-[80] bg-black/50 backdrop-blur-sm flex items-center justify-center">
          <Loader2 className="h-8 w-8 text-amber-400 animate-spin" />
        </div>
      )}

      {/* Modal de detalle */}
      {detalle && (
        <div
          className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setDetalle(null)}
        >
          <div
            className="w-full max-w-3xl max-h-[85vh] bg-[#0d1320] border border-white/10 rounded-2xl overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Cabecera del modal */}
            <div className="flex items-start gap-4 p-5 border-b border-white/[0.06]">
              {/* Foto del catálogo de Aldo Autopartes (por código) */}
              <FotoArticulo
                codigo={detalle.articulo.codigo}
                className="h-24 w-24 shrink-0 rounded-xl border border-white/10"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-lg font-black text-amber-300">
                    {detalle.articulo.codigo}
                  </h2>
                  <span
                    className={cn(
                      "text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-lg border",
                      detalle.articulo.existencia > 0
                        ? "text-emerald-300 bg-emerald-500/10 border-emerald-500/25"
                        : "text-rose-300 bg-rose-500/10 border-rose-500/25"
                    )}
                  >
                    {detalle.articulo.existencia > 0
                      ? `Existencia ${entero(detalle.articulo.existencia)}`
                      : "Sin existencia"}
                  </span>
                  {rangoAnios(detalle.articulo.aini, detalle.articulo.afin) !== "—" && (
                    <span className="text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-lg border text-cyan-300 bg-cyan-500/10 border-cyan-500/25">
                      Años {rangoAnios(detalle.articulo.aini, detalle.articulo.afin)}
                    </span>
                  )}
                </div>
                <p className="text-[11px] font-bold text-slate-300 mt-1.5">
                  {detalle.articulo.descripcion}
                </p>
                <p className="text-[11px] font-bold text-slate-500 mt-1">
                  {detalle.articulo.linea} · {detalle.articulo.parte}
                  {detalle.articulo.proveedor ? ` · ${detalle.articulo.proveedor}` : ""}
                </p>
              </div>
              <button
                onClick={() => setDetalle(null)}
                className="p-2 rounded-xl text-slate-500 hover:text-white hover:bg-white/[0.06] transition-colors shrink-0"
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Secciones */}
            <div className="flex-1 overflow-auto p-5 space-y-5">
              {/* Precio Vidaurri */}
              <div>
                <p className={cn(lbl, "mb-2")}>Precio Vidaurri</p>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  {[
                    { titulo: "Lista", valor: moneda(detalle.articulo.precioLista), color: "text-slate-200" },
                    { titulo: "Precio sin IVA", valor: moneda(detalle.articulo.precioVta), color: "text-slate-200" },
                    { titulo: "Precio con IVA", valor: moneda(conIva(detalle.articulo.precioVta)), color: "text-amber-300" },
                    { titulo: "Descuento", valor: `${detalle.articulo.descuento}%`, color: "text-cyan-300" },
                    { titulo: "Utilidad", valor: `${detalle.articulo.utilidad}%`, color: "text-emerald-300" },
                  ].map((c) => (
                    <div
                      key={c.titulo}
                      className="bg-white/[0.03] border border-white/10 rounded-xl p-3"
                    >
                      <p className={lbl}>{c.titulo}</p>
                      <p className={cn("text-sm font-black mt-1 truncate", c.color)}>
                        {c.valor}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Precio Aldo Autopartes (catálogo en línea) */}
              <div>
                <p className={cn(lbl, "mb-2")}>Precio Aldo Autopartes</p>
                {cargandoAldo ? (
                  <div className="flex items-center gap-2 text-slate-500 bg-white/[0.03] border border-white/10 rounded-xl p-3">
                    <Loader2 className="h-4 w-4 animate-spin text-amber-400" />
                    <span className="text-[11px] font-black uppercase tracking-widest">
                      Consultando aldoautopartes.com...
                    </span>
                  </div>
                ) : aldo?.encontrado ? (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="bg-white/[0.03] border border-white/10 rounded-xl p-3">
                        <p className={lbl}>Aldo sin IVA</p>
                        <p className="text-sm font-black mt-1 truncate text-slate-200">
                          {moneda(aldo.sinIva)}
                        </p>
                      </div>
                      <div className="bg-white/[0.03] border border-white/10 rounded-xl p-3">
                        <p className={lbl}>Aldo con IVA</p>
                        <p className="text-sm font-black mt-1 truncate text-cyan-300">
                          {moneda(aldo.conIva)}
                        </p>
                      </div>
                      <div className="bg-white/[0.03] border border-white/10 rounded-xl p-3">
                        <p className={lbl}>Existencia Aldo</p>
                        <p className="text-sm font-black mt-1 truncate text-slate-200">
                          {typeof aldo.existencia === "number"
                            ? entero(aldo.existencia)
                            : (aldo.existencia ?? "—")}
                        </p>
                      </div>
                      {(() => {
                        // Comparativo: precio de venta Vidaurri (sin IVA) contra el de Aldo.
                        const dif = (aldo.sinIva ?? 0) - detalle.articulo.precioVta;
                        const masBarato = dif > 0; // Vidaurri por debajo de Aldo
                        return (
                          <div className="bg-white/[0.03] border border-white/10 rounded-xl p-3">
                            <p className={lbl}>Vidaurri vs Aldo</p>
                            <p
                              className={cn(
                                "text-sm font-black mt-1 truncate",
                                dif === 0
                                  ? "text-slate-400"
                                  : masBarato
                                    ? "text-emerald-300"
                                    : "text-rose-300"
                              )}
                            >
                              {dif === 0
                                ? "Igual"
                                : `${masBarato ? "−" : "+"}${moneda(Math.abs(dif))}`}
                            </p>
                          </div>
                        );
                      })()}
                    </div>
                    {aldo.descripcion && (
                      <p className="text-[10px] font-bold text-slate-500 mt-2">
                        En Aldo: {aldo.descripcion}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-[11px] font-bold text-slate-500 bg-white/[0.03] border border-white/10 rounded-xl p-3">
                    Este código no está en el catálogo en línea de Aldo Autopartes.
                  </p>
                )}
              </div>

              {/* Inventario */}
              <div>
                <p className={cn(lbl, "mb-2")}>Inventario</p>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  {[
                    {
                      titulo: "Existencia",
                      valor: entero(detalle.articulo.existencia),
                      color:
                        detalle.articulo.existencia > 0 ? "text-emerald-300" : "text-slate-500",
                    },
                    { titulo: "Mínimo", valor: entero(detalle.articulo.minimo), color: "text-slate-200" },
                    { titulo: "Máximo", valor: entero(detalle.articulo.maximo), color: "text-slate-200" },
                    { titulo: "Reorden", valor: entero(detalle.articulo.reorden), color: "text-slate-200" },
                    {
                      titulo: "Localización",
                      valor: detalle.articulo.localizacion || "—",
                      color: "text-cyan-300",
                    },
                  ].map((c) => (
                    <div
                      key={c.titulo}
                      className="bg-white/[0.03] border border-white/10 rounded-xl p-3"
                    >
                      <p className={lbl}>{c.titulo}</p>
                      <p className={cn("text-sm font-black mt-1 truncate", c.color)}>
                        {c.valor}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Aplicaciones por modelo */}
              <div>
                <p className={cn(lbl, "mb-2")}>Aplicaciones por modelo</p>
                {detalle.aplicaciones.length === 0 ? (
                  <p className="text-[11px] font-bold text-slate-500">
                    Sin aplicaciones registradas
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {detalle.aplicaciones.map((ap, i) => (
                      <span
                        key={i}
                        className="text-[10px] font-black text-slate-300 bg-white/[0.05] border border-white/10 px-2.5 py-1 rounded-lg"
                      >
                        {ap.modelo}
                        <span className="text-slate-500 ml-1.5">
                          {rangoAnios(ap.aini, ap.afin)}
                        </span>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Códigos alternos */}
              <div>
                <p className={cn(lbl, "mb-2")}>Códigos alternos</p>
                {detalle.codigosAlternos.length === 0 ? (
                  <p className="text-[11px] font-bold text-slate-500">
                    Sin códigos alternos registrados
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {detalle.codigosAlternos.map((ca, i) => (
                      <span
                        key={i}
                        className="text-[10px] font-black text-cyan-300 bg-cyan-500/10 border border-cyan-500/25 px-2.5 py-1 rounded-lg"
                      >
                        {ca.codigoAlterno}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Últimos movimientos */}
              <div>
                <p className={cn(lbl, "mb-2")}>Últimos movimientos</p>
                {detalle.ultimosMovimientos.length === 0 ? (
                  <p className="text-[11px] font-bold text-slate-500">
                    Sin movimientos registrados
                  </p>
                ) : (
                  <div className="border border-white/10 rounded-xl overflow-hidden">
                    <table className="w-full">
                      <thead className="bg-[#141a28]">
                        <tr>
                          <th className={cn(lbl, "px-3 py-2 text-left")}>Fecha</th>
                          <th className={cn(lbl, "px-3 py-2 text-left")}>Tipo</th>
                          <th className={cn(lbl, "px-3 py-2 text-left")}>Documento</th>
                          <th className={cn(lbl, "px-3 py-2 text-right")}>Ant</th>
                          <th className={cn(lbl, "px-3 py-2 text-right")}>Cant</th>
                          <th className={cn(lbl, "px-3 py-2 text-right")}>Post</th>
                          <th className={cn(lbl, "px-3 py-2 text-left")}>Usuario</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/[0.04]">
                        {detalle.ultimosMovimientos.map((mv, i) => (
                          <tr key={i}>
                            <td className="px-3 py-2 text-[11px] font-bold text-slate-400">
                              {fechaCorta(mv.fecha)}
                            </td>
                            <td className="px-3 py-2">
                              <span
                                className={cn(
                                  "text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-lg border",
                                  claseTipoMov(mv.tipoMov)
                                )}
                              >
                                {mv.tipoMov ?? "—"}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-[11px] font-bold text-slate-400">
                              {mv.tipoDoc ?? "—"}
                              {mv.numDoc ? ` ${mv.numDoc}` : ""}
                            </td>
                            <td className="px-3 py-2 text-[11px] font-bold text-slate-500 text-right">
                              {entero(mv.existAnt)}
                            </td>
                            <td className="px-3 py-2 text-[11px] font-black text-slate-200 text-right">
                              {entero(mv.cantidad)}
                            </td>
                            <td className="px-3 py-2 text-[11px] font-black text-slate-300 text-right">
                              {entero(mv.existPost)}
                            </td>
                            <td className="px-3 py-2 text-[11px] font-bold text-slate-400">
                              {mv.usuario || "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
