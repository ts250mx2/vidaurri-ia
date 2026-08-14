"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  FileText,
  Globe,
  ListRestart,
  Loader2,
  PackageSearch,
  RefreshCw,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { moneda, entero } from "@/lib/formato";
import {
  SelectorSucursal,
  type OpcionSucursal,
} from "@/components/dashboard/SelectorSucursal";

// ---------- Tipos ----------
type Fuente = "matriz" | "usadas" | "aldo";

// Tres fuentes: las dos bases propias y el catálogo en línea de Aldo.
const FUENTES: OpcionSucursal<Fuente>[] = [
  { valor: "matriz", etiqueta: "Matriz" },
  { valor: "usadas", etiqueta: "Bodega Usado" },
  { valor: "aldo", etiqueta: "Aldo Autopartes" },
];

interface Articulo {
  id: number;
  codigo: string;
  descripcion: string | null;
  linea: string | null;
  parte: string | null;
  existencia: number;
  precioLista: number;
  valor: number;
  localizacion: string | null;
  minimo: number | null;
  maximo: number | null;
  reorden: number | null;
}

interface Resumen {
  codigos: number;
  piezas: number;
  valorLista: number;
  valorCosto: number;
}

interface PiezaUsada {
  id: number;
  codigo: string;
  descripcion: string | null;
  marca: string | null;
  modelo: string | null;
  anioInicio: number | null;
  anioFin: number | null;
  precio: number;
  existencia: number;
  ubicacion: string | null;
}

interface ResumenUsadas {
  codigos: number;
  piezas: number;
  valor: number;
}

interface ResultadoAldo {
  codigo: string;
  descripcion: string;
  sinIva: number;
  conIva: number;
  existencia: number | string;
}

interface OpcionLinea {
  id: number;
  linea: string;
}

interface OpcionParte {
  id: number;
  parte: string;
}

interface OpcionMarca {
  id: number;
  marca: string;
}

// ---------- Constantes de estilo (patrón kyk-server-web) ----------
const lbl = "text-[10px] font-black text-slate-500 uppercase tracking-widest";
const inputCls =
  "block w-full px-4 py-2.5 bg-white/[0.03] border border-white/10 rounded-xl text-sm font-bold text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-400/25 focus:border-amber-400/60 transition-all";

const PAGE_SIZE = 50;

// Mismo alfabeto que valida el endpoint de Aldo: feedback inmediato sin ir al servidor.
const TERMINO_ALDO_VALIDO = /^[A-Za-z0-9._/-]{2,30}$/;

// Rango de años de aplicación de la Bodega Usado (0/NULL = sin capturar).
const rangoAnios = (inicio: number | null, fin: number | null) => {
  if (!inicio && !fin) return "—";
  if (inicio && fin && inicio !== fin) return `${inicio}-${fin}`;
  return String(inicio ?? fin);
};

export default function ExistenciasPage() {
  const [fuente, setFuente] = useState<Fuente>("matriz");
  const [busqueda, setBusqueda] = useState("");
  const [idLinea, setIdLinea] = useState("");
  const [idParte, setIdParte] = useState("");
  const [idMarca, setIdMarca] = useState("");
  const [idParteUsada, setIdParteUsada] = useState("");
  const [page, setPage] = useState(1);

  const [lineas, setLineas] = useState<OpcionLinea[]>([]);
  const [partes, setPartes] = useState<OpcionParte[]>([]);
  const [marcasUsadas, setMarcasUsadas] = useState<OpcionMarca[]>([]);
  const [partesUsadas, setPartesUsadas] = useState<OpcionParte[]>([]);

  const [articulos, setArticulos] = useState<Articulo[]>([]);
  const [piezas, setPiezas] = useState<PiezaUsada[]>([]);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [resumenUsadas, setResumenUsadas] = useState<ResumenUsadas | null>(null);
  const [total, setTotal] = useState(0);

  const [terminoAldo, setTerminoAldo] = useState("");
  const [resultadosAldo, setResultadosAldo] = useState<ResultadoAldo[]>([]);
  const [buscoAldo, setBuscoAldo] = useState(false);

  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [exportando, setExportando] = useState<"pdf" | "excel" | null>(null);

  // Token de secuencia: descarta respuestas de peticiones obsoletas
  // cuando el usuario cambia filtros/página/fuente más rápido de lo que
  // responde la API (la de la Bodega es remota y la de Aldo, externa).
  const peticionRef = useRef(0);

  const cargarMatriz = useCallback(
    async (filtro: string, linea: string, parte: string, pagina: number) => {
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
        const res = await fetch(`/api/inventario/existencias?${qs.toString()}`);
        // Si empezó una petición más nueva, descarta esta silenciosamente.
        if (idPeticion !== peticionRef.current) return;
        if (res.status === 401) {
          window.location.href = "/login";
          return;
        }
        const json = await res.json();
        if (idPeticion !== peticionRef.current) return;
        if (!res.ok) throw new Error(json.error || "Error al consultar existencias");
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
        // Solo apaga el spinner si esta sigue siendo la petición vigente.
        if (idPeticion === peticionRef.current) setCargando(false);
      }
    },
    []
  );

  const cargarUsadas = useCallback(
    async (
      filtro: string,
      marca: string,
      parte: string,
      pagina: number,
      conCatalogos: boolean
    ) => {
      const idPeticion = ++peticionRef.current;
      setCargando(true);
      setError("");
      try {
        const qs = new URLSearchParams({
          sucursal: "usadas",
          page: String(pagina),
          pageSize: String(PAGE_SIZE),
        });
        if (filtro) qs.set("busqueda", filtro);
        if (marca) qs.set("idMarca", marca);
        if (parte) qs.set("idParte", parte);
        // Los catálogos de la Bodega se piden solo la primera vez.
        if (conCatalogos) qs.set("catalogos", "1");
        const res = await fetch(`/api/inventario/existencias?${qs.toString()}`);
        if (idPeticion !== peticionRef.current) return;
        if (res.status === 401) {
          window.location.href = "/login";
          return;
        }
        const json = await res.json();
        if (idPeticion !== peticionRef.current) return;
        if (!res.ok) throw new Error(json.error || "Error al consultar existencias");
        setPiezas(json.piezas);
        setResumenUsadas(json.resumen);
        setTotal(json.total);
        if (json.catalogos) {
          setMarcasUsadas(json.catalogos.marcas ?? []);
          setPartesUsadas(json.catalogos.partes ?? []);
        }
      } catch (err: unknown) {
        if (idPeticion !== peticionRef.current) return;
        setError(err instanceof Error ? err.message : "Error desconocido");
        setPiezas([]);
        setResumenUsadas(null);
        setTotal(0);
      } finally {
        if (idPeticion === peticionRef.current) setCargando(false);
      }
    },
    []
  );

  useEffect(() => {
    cargarMatriz("", "", "", 1);
  }, [cargarMatriz]);

  useEffect(() => {
    // Catálogos de la matriz para los selects; si fallan, los selects quedan
    // vacíos pero el listado sigue funcionando (no se bloquea la página).
    const cargarCatalogos = async () => {
      try {
        const res = await fetch("/api/articulos/catalogos");
        if (res.status === 401) {
          window.location.href = "/login";
          return;
        }
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Error al cargar catálogos");
        setLineas(json.lineas ?? []);
        setPartes(json.partes ?? []);
      } catch {
        setLineas([]);
        setPartes([]);
      }
    };
    cargarCatalogos();
  }, []);

  // Búsqueda en Aldo: solo por botón/submit (nunca en cada tecla, es un sitio externo).
  const buscarEnAldo = async (e?: FormEvent<HTMLFormElement>) => {
    e?.preventDefault();
    const termino = terminoAldo.trim();
    if (!TERMINO_ALDO_VALIDO.test(termino)) {
      setError("Escribe de 2 a 30 caracteres (letras, números, . _ / -)");
      return;
    }
    const idPeticion = ++peticionRef.current;
    setCargando(true);
    setError("");
    setBuscoAldo(true);
    try {
      const res = await fetch(
        `/api/inventario/existencias-aldo?termino=${encodeURIComponent(termino)}`
      );
      if (idPeticion !== peticionRef.current) return;
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      const json = await res.json();
      if (idPeticion !== peticionRef.current) return;
      if (!res.ok) throw new Error(json.error || "Aldo no respondió");
      setResultadosAldo(json.resultados);
    } catch (err: unknown) {
      if (idPeticion !== peticionRef.current) return;
      setError(err instanceof Error ? err.message : "Error desconocido");
      setResultadosAldo([]);
    } finally {
      if (idPeticion === peticionRef.current) setCargando(false);
    }
  };

  const actualizar = () => {
    setPage(1);
    if (fuente === "matriz") cargarMatriz(busqueda, idLinea, idParte, 1);
    else cargarUsadas(busqueda, idMarca, idParteUsada, 1, marcasUsadas.length === 0);
  };

  const limpiar = () => {
    setBusqueda("");
    setPage(1);
    if (fuente === "matriz") {
      setIdLinea("");
      setIdParte("");
      cargarMatriz("", "", "", 1);
    } else {
      setIdMarca("");
      setIdParteUsada("");
      cargarUsadas("", "", "", 1, marcasUsadas.length === 0);
    }
  };

  // Al cambiar de fuente se limpian resultados y filtros que no aplican,
  // y se invalida cualquier respuesta en vuelo de la fuente anterior.
  const cambiarFuente = (nueva: Fuente) => {
    if (nueva === fuente) return;
    peticionRef.current++;
    setFuente(nueva);
    setBusqueda("");
    setIdLinea("");
    setIdParte("");
    setIdMarca("");
    setIdParteUsada("");
    setPage(1);
    setError("");
    setArticulos([]);
    setResumen(null);
    setPiezas([]);
    setResumenUsadas(null);
    setTotal(0);
    setTerminoAldo("");
    setResultadosAldo([]);
    setBuscoAldo(false);
    if (nueva === "matriz") {
      cargarMatriz("", "", "", 1);
    } else if (nueva === "usadas") {
      cargarUsadas("", "", "", 1, marcasUsadas.length === 0);
    } else {
      // Aldo espera un término: no se dispara nada hasta que el usuario busque.
      setCargando(false);
    }
  };

  const cambiarPagina = (pagina: number) => {
    setPage(pagina);
    if (fuente === "matriz") cargarMatriz(busqueda, idLinea, idParte, pagina);
    else cargarUsadas(busqueda, idMarca, idParteUsada, pagina, false);
  };

  const exportar = async (formato: "pdf" | "excel") => {
    setExportando(formato);
    setError("");
    try {
      // Trae el inventario completo (hasta el tope del servidor) para exportar todo.
      const qs = new URLSearchParams({ page: "1", pageSize: "20000" });
      if (busqueda) qs.set("busqueda", busqueda);
      const esUsadas = fuente === "usadas";
      if (esUsadas) {
        qs.set("sucursal", "usadas");
        if (idMarca) qs.set("idMarca", idMarca);
        if (idParteUsada) qs.set("idParte", idParteUsada);
      } else {
        if (idLinea) qs.set("idLinea", idLinea);
        if (idParte) qs.set("idParte", idParte);
      }
      const res = await fetch(`/api/inventario/existencias?${qs.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error al exportar");

      if (esUsadas) {
        const filas: PiezaUsada[] = json.piezas;
        const nombreMarca = marcasUsadas.find((m) => String(m.id) === idMarca)?.marca ?? "";
        const nombreParte =
          partesUsadas.find((p) => String(p.id) === idParteUsada)?.parte ?? "";
        const base = {
          titulo: "INVENTARIO · EXISTENCIAS · BODEGA USADO",
          subtitulo: `Valuado a precio sin IVA${nombreMarca ? `  ·  ${nombreMarca}` : ""}${
            nombreParte ? `  ·  ${nombreParte}` : ""
          }${busqueda ? `  ·  "${busqueda}"` : ""}  ·  ${entero(filas.length)} piezas`,
          columnas: [
            { header: "Código" },
            { header: "Descripción" },
            { header: "Marca" },
            { header: "Modelo" },
            { header: "Años" },
            { header: "Precio", align: "right" as const },
            { header: "Existencia", align: "right" as const },
            { header: "Ubicación" },
          ],
          nombreArchivo: `existencias_usadas_${new Date().toLocaleDateString("sv-SE")}`,
        };
        if (formato === "pdf") {
          const { exportarPdf } = await import("@/lib/export");
          await exportarPdf({
            ...base,
            orientacion: "landscape",
            filas: filas.map((p) => [
              p.codigo,
              p.descripcion ?? "",
              p.marca ?? "",
              p.modelo ?? "",
              rangoAnios(p.anioInicio, p.anioFin),
              p.precio > 0 ? moneda(p.precio) : "—",
              entero(p.existencia),
              p.ubicacion || "",
            ]),
          });
        } else {
          const { exportarExcel } = await import("@/lib/export");
          await exportarExcel({
            ...base,
            hoja: "Existencias Bodega",
            columnasMoneda: [5],
            filas: filas.map((p) => [
              p.codigo,
              p.descripcion ?? "",
              p.marca ?? "",
              p.modelo ?? "",
              rangoAnios(p.anioInicio, p.anioFin),
              p.precio,
              p.existencia,
              p.ubicacion || "",
            ]),
          });
        }
        return;
      }

      const filas: Articulo[] = json.articulos;
      const nombreLinea = lineas.find((l) => String(l.id) === idLinea)?.linea ?? "";
      const nombreParte = partes.find((p) => String(p.id) === idParte)?.parte ?? "";
      const columnas = [
        { header: "Código" },
        { header: "Descripción" },
        { header: "Línea" },
        { header: "Parte" },
        { header: "Localización" },
        { header: "Existencia", align: "right" as const },
        { header: "Precio lista", align: "right" as const },
        { header: "Valor", align: "right" as const },
        { header: "Mín", align: "right" as const },
        { header: "Máx", align: "right" as const },
        { header: "Reorden", align: "right" as const },
      ];
      const base = {
        titulo: "INVENTARIO · EXISTENCIAS",
        subtitulo: `Valuado a precio de lista${nombreLinea ? `  ·  ${nombreLinea}` : ""}${
          nombreParte ? `  ·  ${nombreParte}` : ""
        }${busqueda ? `  ·  "${busqueda}"` : ""}  ·  ${entero(filas.length)} códigos`,
        columnas,
        nombreArchivo: `existencias_${new Date().toLocaleDateString("sv-SE")}`,
      };

      if (formato === "pdf") {
        const { exportarPdf } = await import("@/lib/export");
        await exportarPdf({
          ...base,
          orientacion: "landscape",
          filas: filas.map((a) => [
            a.codigo,
            a.descripcion ?? "",
            a.linea ?? "",
            a.parte ?? "",
            a.localizacion ?? "",
            entero(a.existencia),
            moneda(a.precioLista),
            moneda(a.valor),
            a.minimo == null ? "" : entero(a.minimo),
            a.maximo == null ? "" : entero(a.maximo),
            a.reorden == null ? "" : entero(a.reorden),
          ]),
        });
      } else {
        const { exportarExcel } = await import("@/lib/export");
        await exportarExcel({
          ...base,
          hoja: "Existencias",
          columnasMoneda: [6, 7],
          filas: filas.map((a) => [
            a.codigo,
            a.descripcion ?? "",
            a.linea ?? "",
            a.parte ?? "",
            a.localizacion ?? "",
            a.existencia,
            a.precioLista,
            a.valor,
            a.minimo,
            a.maximo,
            a.reorden,
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
  const esUsadas = fuente === "usadas";
  const esAldo = fuente === "aldo";
  const filasVisibles = esAldo
    ? resultadosAldo.length
    : esUsadas
      ? piezas.length
      : articulos.length;

  const tarjetas =
    fuente === "matriz" && resumen
      ? [
          { titulo: "Códigos", valor: entero(resumen.codigos), color: "text-slate-200" },
          { titulo: "Piezas", valor: entero(resumen.piezas), color: "text-cyan-300" },
          { titulo: "Valor a lista", valor: moneda(resumen.valorLista), color: "text-amber-300" },
          { titulo: "Valor a costo", valor: moneda(resumen.valorCosto), color: "text-emerald-300" },
        ]
      : esUsadas && resumenUsadas
        ? [
            { titulo: "Códigos", valor: entero(resumenUsadas.codigos), color: "text-slate-200" },
            { titulo: "Piezas", valor: entero(resumenUsadas.piezas), color: "text-cyan-300" },
            { titulo: "Valor sin IVA", valor: moneda(resumenUsadas.valor), color: "text-amber-300" },
          ]
        : [];

  const subtitulo = cargando
    ? "Consultando..."
    : esAldo
      ? buscoAldo
        ? `${entero(resultadosAldo.length)} resultados en el catálogo de Aldo`
        : "Catálogo en línea de Aldo Autopartes"
      : esUsadas
        ? `${entero(total)} piezas con existencia`
        : `${entero(total)} códigos con existencia`;

  return (
    <div className="space-y-4">
      {/* Encabezado */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight">Existencias</h1>
          <p className={cn(lbl, "mt-1")}>{subtitulo}</p>
        </div>
        <div className="flex items-center gap-2">
          <SelectorSucursal opciones={FUENTES} valor={fuente} onCambio={cambiarFuente} />
          {/* Sin exportación para Aldo: catálogo externo de máx. 50 filas. */}
          {!esAldo && (
            <>
              <button
                onClick={() => exportar("pdf")}
                disabled={!!exportando || cargando || filasVisibles === 0}
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
                disabled={!!exportando || cargando || filasVisibles === 0}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/[0.05] border border-white/10 text-slate-300 text-[11px] font-black uppercase tracking-widest hover:text-emerald-300 transition-all disabled:opacity-40"
              >
                {exportando === "excel" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                )}
                Excel
              </button>
            </>
          )}
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-4 backdrop-blur-xl">
        {esAldo ? (
          <form onSubmit={buscarEnAldo} className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[260px]">
                <Search className="absolute top-1/2 -translate-y-1/2 left-3.5 h-4 w-4 text-slate-500" />
                <input
                  type="text"
                  className={cn(inputCls, "pl-10")}
                  placeholder="Escribe un código o fragmento, ej. CAC"
                  value={terminoAldo}
                  onChange={(e) => setTerminoAldo(e.target.value)}
                />
              </div>
              <button
                type="submit"
                disabled={cargando}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500 text-slate-950 text-[11px] font-black uppercase tracking-widest hover:brightness-110 transition-all disabled:opacity-40"
              >
                {cargando ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Search className="h-3.5 w-3.5" />
                )}
                Buscar
              </button>
            </div>
            <p className={lbl}>Catálogo en línea de aldoautopartes.com — precios de lista</p>
          </form>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute top-1/2 -translate-y-1/2 left-3.5 h-4 w-4 text-slate-500" />
              <input
                type="text"
                className={cn(inputCls, "pl-10")}
                placeholder="Buscar por código o descripción..."
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && actualizar()}
              />
            </div>
            {esUsadas ? (
              <>
                <div className="space-y-1.5">
                  <label className={lbl}>Marca</label>
                  <select
                    className={cn(inputCls, "w-48 appearance-none [color-scheme:dark]")}
                    value={idMarca}
                    onChange={(e) => setIdMarca(e.target.value)}
                  >
                    <option value="" className="bg-[#0d1320]">Todas</option>
                    {marcasUsadas.map((m) => (
                      <option key={m.id} value={m.id} className="bg-[#0d1320]">
                        {m.marca}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className={lbl}>Parte</label>
                  <select
                    className={cn(inputCls, "w-48 appearance-none [color-scheme:dark]")}
                    value={idParteUsada}
                    onChange={(e) => setIdParteUsada(e.target.value)}
                  >
                    <option value="" className="bg-[#0d1320]">Todas</option>
                    {partesUsadas.map((p) => (
                      <option key={p.id} value={p.id} className="bg-[#0d1320]">
                        {p.parte}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            ) : (
              <>
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
              </>
            )}
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
        )}
      </div>

      {/* Tarjetas de resumen */}
      {tarjetas.length > 0 && (
        <div
          className={cn(
            "grid grid-cols-2 gap-3",
            esUsadas ? "lg:grid-cols-3" : "lg:grid-cols-4"
          )}
        >
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
        ) : esAldo && !buscoAldo ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3 text-slate-500">
            <Globe className="h-10 w-10" />
            <p className="text-[11px] font-black uppercase tracking-widest">
              Escribe un código o fragmento y presiona Buscar
            </p>
          </div>
        ) : filasVisibles === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3 text-slate-500">
            <PackageSearch className="h-10 w-10" />
            <p className="text-[11px] font-black uppercase tracking-widest">
              {esAldo
                ? "Sin resultados en el catálogo de Aldo"
                : esUsadas
                  ? "Sin piezas con existencia para los filtros seleccionados"
                  : "Sin artículos con existencia para los filtros seleccionados"}
            </p>
          </div>
        ) : esAldo ? (
          <div className="overflow-auto max-h-[calc(100vh-24rem)]">
            <table className="w-full">
              <thead className="sticky top-0 z-10 bg-[#10151f] shadow-[0_1px_0_rgba(255,255,255,0.08)]">
                <tr>
                  <th className={cn(lbl, "px-4 py-2.5 text-left")}>Código</th>
                  <th className={cn(lbl, "px-4 py-2.5 text-left")}>Descripción</th>
                  <th className={cn(lbl, "px-4 py-2.5 text-right")}>Sin IVA</th>
                  <th className={cn(lbl, "px-4 py-2.5 text-right")}>Con IVA</th>
                  <th className={cn(lbl, "px-4 py-2.5 text-right")}>Existencia</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {resultadosAldo.map((r, i) => (
                  <tr key={`${r.codigo}-${i}`} className="transition-colors hover:bg-white/[0.03]">
                    <td className="px-4 py-2.5 text-[12px] font-black text-amber-300 whitespace-nowrap">
                      {r.codigo}
                    </td>
                    <td className="px-4 py-2.5 text-[12px] font-bold text-slate-300 max-w-[380px] truncate">
                      {r.descripcion}
                    </td>
                    <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400 text-right whitespace-nowrap">
                      {moneda(r.sinIva)}
                    </td>
                    <td className="px-4 py-2.5 text-[12px] font-black text-amber-300 text-right whitespace-nowrap">
                      {moneda(r.conIva)}
                    </td>
                    <td className="px-4 py-2.5 text-[12px] font-black text-slate-200 text-right whitespace-nowrap">
                      {typeof r.existencia === "number" ? entero(r.existencia) : r.existencia}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : esUsadas ? (
          <>
            <div className="overflow-auto max-h-[calc(100vh-24rem)]">
              <table className="w-full">
                <thead className="sticky top-0 z-10 bg-[#10151f] shadow-[0_1px_0_rgba(255,255,255,0.08)]">
                  <tr>
                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Código</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Descripción</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Marca</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Modelo</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Años</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Precio</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Existencia</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Ubicación</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {piezas.map((p) => (
                    <tr key={p.id} className="transition-colors hover:bg-white/[0.03]">
                      <td className="px-4 py-2.5 text-[12px] font-black text-amber-300 whitespace-nowrap">
                        {p.codigo}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-bold text-slate-300 max-w-[280px] truncate">
                        {p.descripcion}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400">
                        {p.marca ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400">
                        {p.modelo ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-bold text-slate-500 whitespace-nowrap">
                        {rangoAnios(p.anioInicio, p.anioFin)}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-black text-amber-300 text-right whitespace-nowrap">
                        {p.precio > 0 ? moneda(p.precio) : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-black text-slate-200 text-right">
                        {entero(p.existencia)}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-bold text-cyan-300 whitespace-nowrap">
                        {p.ubicacion || "—"}
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
        ) : (
          <>
            <div className="overflow-auto max-h-[calc(100vh-24rem)]">
              <table className="w-full">
                <thead className="sticky top-0 z-10 bg-[#10151f] shadow-[0_1px_0_rgba(255,255,255,0.08)]">
                  <tr>
                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Código</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Descripción</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Línea</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Parte</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-left")}>Localización</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Existencia</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Precio lista</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Valor</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Mín</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Máx</th>
                    <th className={cn(lbl, "px-4 py-2.5 text-right")}>Reorden</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {articulos.map((a) => (
                    <tr key={a.id} className="transition-colors hover:bg-white/[0.03]">
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
                      <td className="px-4 py-2.5 text-[12px] font-bold text-cyan-300">
                        {a.localizacion ?? "—"}
                      </td>
                      <td
                        className={cn(
                          "px-4 py-2.5 text-[12px] font-black text-right",
                          a.minimo != null && a.minimo > 0 && a.existencia < a.minimo
                            ? "text-rose-300"
                            : "text-slate-200"
                        )}
                      >
                        {entero(a.existencia)}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-bold text-slate-400 text-right">
                        {moneda(a.precioLista)}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-black text-amber-300 text-right">
                        {moneda(a.valor)}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-bold text-slate-500 text-right">
                        {a.minimo == null ? "—" : entero(a.minimo)}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-bold text-slate-500 text-right">
                        {a.maximo == null ? "—" : entero(a.maximo)}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] font-bold text-slate-500 text-right">
                        {a.reorden == null ? "—" : entero(a.reorden)}
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
    </div>
  );
}
