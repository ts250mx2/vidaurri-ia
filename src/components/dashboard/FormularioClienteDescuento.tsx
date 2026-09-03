"use client";

import { type FormEvent, type MouseEvent, type ReactNode, useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Info, Loader2, Plus, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { fechaCorta, porcentaje } from "@/lib/formato";
import { TELEFONOS_MAX, type ClienteDescuento } from "@/lib/clientes-descuento";
import type { ResultadoBienvenida } from "@/lib/whatsapp-bienvenida";
import { useDialogo } from "@/components/dashboard/useDialogo";

// Alta y edición de un cliente con descuento del Vendedor IA. El celular es
// la llave con la que WhatsApp reconoce al cliente, pero es opcional: la lista
// APV trae miles de clientes sin él. Un cliente puede tener varios celulares
// (dueño, taller, familia): el principal se busca en el catálogo de clientes
// de bdav y, si está, se prellenan nombre y descuento; si no, en el alta el
// nombre queda vacío y el descuento propone el valor por defecto
// (DESCUENTO_DEFAULT del .env). RFC, otros teléfonos y email son datos de
// contacto sin más validación que su largo. En edición la búsqueda solo
// sobreescribe si el catálogo sí lo tiene: lo capturado a mano no se pierde.
// Lo que el usuario teclee mientras la búsqueda está en vuelo tampoco se pisa.

interface ClienteCatalogo {
  id: number;
  nombre: string;
  telefono: string;
  descuento: number;
  activo: number;
  exacto: boolean;
}

interface RespuestaBusqueda {
  telefono: string;
  registrado: ClienteDescuento | null;
  enBdav: ClienteCatalogo | null;
  coincidencias: number;
  catalogoNoDisponible: boolean;
  descuentoDefault: number;
  propuesta: { cliente: string; descuento: number; idClienteBdav: number | null };
}

interface RespuestaGuardado {
  registro?: ClienteDescuento;
  existente?: ClienteDescuento | null;
  /** Solo en el alta: cómo le fue a la bienvenida por WhatsApp. */
  bienvenida?: ResultadoBienvenida;
  error?: string;
}

/** Lo que se sabe del último teléfono buscado (o del registro que se edita). */
interface Conocido {
  digitos: string;
  idClienteBdav: number | null;
  resultado: RespuestaBusqueda | null;
}

/** Un celular adicional del formulario; el id solo sirve como key estable. */
interface CelularExtra {
  id: number;
  valor: string;
}

export type ModoFormulario = "alta" | "edicion";

interface Props {
  modo: ModoFormulario;
  /** Registro que se edita (solo en modo edición). */
  registro?: ClienteDescuento;
  /** Debe ser estable (useCallback): el diálogo lo usa en sus efectos. */
  onCerrar: () => void;
  /** En el alta llega además el resultado de la bienvenida por WhatsApp. */
  onGuardado: (
    registro: ClienteDescuento,
    modo: ModoFormulario,
    bienvenida?: ResultadoBienvenida
  ) => void;
  /** El teléfono ya estaba en el padrón: el usuario pidió editar ese registro. */
  onEditarExistente: (registro: ClienteDescuento) => void;
}

const lbl = "text-[10px] font-black text-slate-500 uppercase tracking-widest";
const inputCls =
  "block w-full px-4 py-2.5 bg-white/[0.03] border border-white/10 rounded-xl text-sm font-bold text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-400/25 focus:border-amber-400/60 transition-all";
const btnSecundario =
  "flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/[0.05] border border-white/10 text-slate-300 text-[11px] font-black uppercase tracking-widest hover:text-amber-300 transition-all disabled:opacity-40";

const DIGITOS_MINIMOS = 10;
const soloDigitos = (texto: string) => texto.replace(/\D/g, "");

type Tono = "ambar" | "verde" | "rojo" | "gris";
const tonos: Record<Tono, string> = {
  ambar: "bg-amber-500/10 border-amber-500/25 text-amber-200",
  verde: "bg-emerald-500/10 border-emerald-500/25 text-emerald-200",
  rojo: "bg-rose-500/10 border-rose-500/25 text-rose-200",
  gris: "bg-white/[0.04] border-white/10 text-slate-300",
};

function Aviso({ tono, icono, children }: { tono: Tono; icono: ReactNode; children: ReactNode }) {
  return (
    <div
      role="status"
      className={cn("flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-[13px] leading-relaxed", tonos[tono])}
    >
      <span className="mt-0.5 shrink-0">{icono}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Los celulares del registro que no son el principal, listos para editarse. */
function extrasIniciales(registro?: ClienteDescuento): CelularExtra[] {
  if (!registro) return [];
  return registro.telefonos
    .filter((t) => t !== registro.telefono)
    .map((valor, id) => ({ id, valor }));
}

export function FormularioClienteDescuento({
  modo,
  registro,
  onCerrar,
  onGuardado,
  onEditarExistente,
}: Props) {
  const esAlta = modo === "alta";
  const router = useRouter();
  const [telefono, setTelefono] = useState(registro?.telefono ?? "");
  const [extras, setExtras] = useState<CelularExtra[]>(() => extrasIniciales(registro));
  const [cliente, setCliente] = useState(registro?.cliente ?? "");
  const [descuento, setDescuento] = useState(registro ? String(registro.descuento) : "");
  const [rfc, setRfc] = useState(registro?.rfc ?? "");
  const [telefono2, setTelefono2] = useState(registro?.telefono2 ?? "");
  const [email, setEmail] = useState(registro?.email ?? "");
  const [permitirPedido, setPermitirPedido] = useState(registro?.permitirPedido ?? false);
  const [idClienteBdav, setIdClienteBdav] = useState<number | null>(
    registro?.idClienteBdav ?? null
  );
  const [buscando, setBuscando] = useState(false);
  const [resultado, setResultado] = useState<RespuestaBusqueda | null>(null);
  const [errorBusqueda, setErrorBusqueda] = useState("");
  /** El servidor rechazó el alta/edición porque un celular ya es de otro cliente. */
  const [duplicado, setDuplicado] = useState<ClienteDescuento | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  // Espejos síncronos de los campos: las respuestas tardías se comparan
  // contra lo que el usuario tiene AHORA, no contra el render de cuando salió.
  const telefonoActualRef = useRef(registro?.telefono ?? "");
  const clienteActualRef = useRef(registro?.cliente ?? "");
  const descuentoActualRef = useRef(registro ? String(registro.descuento) : "");
  const guardandoRef = useRef(false);
  /** Última búsqueda aplicada (o el registro en edición): permite revertir. */
  const conocidoRef = useRef<Conocido>({
    digitos: registro?.telefono ?? "",
    idClienteBdav: registro?.idClienteBdav ?? null,
    resultado: null,
  });
  /** Número de la búsqueda más reciente: una respuesta de otra anterior se descarta. */
  const solicitudRef = useRef(0);
  /** Dígitos de la búsqueda en vuelo: el clic en "Buscar" llega después del blur. */
  const enVueloRef = useRef<string | null>(null);
  /** El clic en el fondo solo cierra si el mouse también se PRESIONÓ en el fondo. */
  const presionEnFondoRef = useRef(false);
  /** Siguiente key para un celular adicional. */
  const siguienteExtraRef = useRef(extras.length);
  const dialogoRef = useRef<HTMLDivElement>(null);
  const telefonoRef = useRef<HTMLInputElement>(null);

  /** Mientras se guarda no se puede cerrar: evita dobles envíos y pérdidas. */
  const cerrar = useCallback(() => {
    if (!guardandoRef.current) onCerrar();
  }, [onCerrar]);

  useDialogo(dialogoRef, cerrar, telefonoRef);

  const buscar = useCallback(
    async (prellenar: boolean) => {
      const crudo = telefonoActualRef.current;
      const digitos = soloDigitos(crudo);
      if (digitos.length < DIGITOS_MINIMOS) {
        setErrorBusqueda("Captura los 10 dígitos del teléfono");
        return;
      }
      // Blur y clic sobre el mismo número: una sola consulta.
      if (enVueloRef.current === digitos) return;

      const solicitud = ++solicitudRef.current;
      enVueloRef.current = digitos;
      const clienteAlSalir = clienteActualRef.current;
      const descuentoAlSalir = descuentoActualRef.current;
      setBuscando(true);
      setErrorBusqueda("");
      setDuplicado(null);
      try {
        const res = await fetch(
          `/api/clientes-descuento/buscar?telefono=${encodeURIComponent(crudo)}`
        );
        if (res.status === 401) {
          router.push("/login");
          return;
        }
        const cuerpo = (await res.json().catch(() => null)) as
          | (RespuestaBusqueda & { error?: string })
          | null;
        if (!res.ok || !cuerpo || cuerpo.error) {
          throw new Error(cuerpo?.error ?? "No se pudo buscar el teléfono");
        }
        // Llegó tarde: hubo otra búsqueda después, o el usuario ya cambió el número.
        if (solicitud !== solicitudRef.current) return;
        if (soloDigitos(telefonoActualRef.current) !== digitos) return;

        const propuesta = cuerpo.propuesta;
        conocidoRef.current = {
          digitos: cuerpo.telefono,
          idClienteBdav: propuesta.idClienteBdav,
          resultado: cuerpo,
        };
        telefonoActualRef.current = cuerpo.telefono;
        setTelefono(cuerpo.telefono);
        setResultado(cuerpo);
        if (!prellenar) return;

        if (cuerpo.enBdav) {
          // El catálogo manda: nombre y descuento oficiales del cliente.
          clienteActualRef.current = propuesta.cliente;
          descuentoActualRef.current = String(propuesta.descuento);
          setCliente(propuesta.cliente);
          setDescuento(String(propuesta.descuento));
          setIdClienteBdav(propuesta.idClienteBdav);
        } else if (esAlta) {
          // No está: nombre vacío y descuento por defecto, salvo lo que el
          // usuario haya tecleado mientras la búsqueda estaba en vuelo.
          if (clienteActualRef.current === clienteAlSalir) {
            clienteActualRef.current = "";
            setCliente("");
          }
          if (descuentoActualRef.current === descuentoAlSalir) {
            descuentoActualRef.current = String(propuesta.descuento);
            setDescuento(String(propuesta.descuento));
          }
          setIdClienteBdav(null);
        }
        // En edición sin empate en el catálogo se conserva lo capturado.
      } catch (err: unknown) {
        if (solicitud === solicitudRef.current) {
          setErrorBusqueda(err instanceof Error ? err.message : "Error al buscar");
        }
      } finally {
        if (solicitud === solicitudRef.current) {
          enVueloRef.current = null;
          setBuscando(false);
        }
      }
    },
    [esAlta, router]
  );

  const cambiarTelefono = (valor: string) => {
    telefonoActualRef.current = valor;
    setTelefono(valor);
    setDuplicado(null);
    const digitos = soloDigitos(valor);
    const conocido = conocidoRef.current;
    if (digitos === conocido.digitos) {
      // Tecleó y regresó al número ya buscado: vuelve lo que se sabía de él.
      setIdClienteBdav(conocido.idClienteBdav);
      setResultado(conocido.resultado);
    } else {
      setIdClienteBdav(null);
      setResultado(null);
    }
  };

  const agregarExtra = () => {
    const id = siguienteExtraRef.current++;
    setExtras((lista) => [...lista, { id, valor: "" }]);
  };
  const cambiarExtra = (id: number, valor: string) => {
    setDuplicado(null);
    setExtras((lista) => lista.map((e) => (e.id === id ? { ...e, valor } : e)));
  };
  const quitarExtra = (id: number) => {
    setExtras((lista) => lista.filter((e) => e.id !== id));
  };

  const cambiarCliente = (valor: string) => {
    clienteActualRef.current = valor;
    setCliente(valor);
  };

  const cambiarDescuento = (valor: string) => {
    descuentoActualRef.current = valor;
    setDescuento(valor);
  };

  /** En el alta, salir del campo con un número completo ya lo busca. */
  const alSalirTelefono = () => {
    if (!esAlta) return;
    const digitos = soloDigitos(telefonoActualRef.current);
    if (digitos.length >= DIGITOS_MINIMOS && digitos !== conocidoRef.current.digitos) {
      void buscar(true);
    }
  };

  const guardar = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    const celulares = [telefono, ...extras.map((x) => x.valor)].filter((v) => v.trim() !== "");
    const incompleto = celulares.find((v) => soloDigitos(v).length < DIGITOS_MINIMOS);
    if (incompleto !== undefined) {
      setError(`El celular "${incompleto.trim()}" debe tener 10 dígitos`);
      return;
    }
    if (!cliente.trim()) {
      setError("Captura el nombre del cliente");
      return;
    }
    const numero = Number(descuento.trim().replace(",", "."));
    if (descuento.trim() === "" || !Number.isFinite(numero) || numero < 0 || numero > 100) {
      setError("El descuento debe ser un número entre 0 y 100");
      return;
    }

    guardandoRef.current = true;
    setGuardando(true);
    try {
      const url = esAlta ? "/api/clientes-descuento" : `/api/clientes-descuento/${registro?.id}`;
      const res = await fetch(url, {
        method: esAlta ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          telefonos: celulares,
          cliente: cliente.trim(),
          descuento: numero,
          rfc: rfc.trim(),
          telefono2: telefono2.trim(),
          email: email.trim(),
          idClienteApv: registro?.idClienteApv ?? null,
          idClienteBdav,
          permitirPedido,
        }),
      });
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      const cuerpo = (await res.json().catch(() => null)) as RespuestaGuardado | null;
      if (!res.ok || !cuerpo?.registro) {
        if (res.status === 409 && cuerpo?.existente) setDuplicado(cuerpo.existente);
        throw new Error(cuerpo?.error ?? "No se pudo guardar");
      }
      onGuardado(cuerpo.registro, modo, cuerpo.bienvenida);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      guardandoRef.current = false;
      setGuardando(false);
    }
  };

  const alPresionarFondo = (e: MouseEvent<HTMLDivElement>) => {
    presionEnFondoRef.current = e.target === e.currentTarget;
  };
  const alSoltarEnFondo = (e: MouseEvent<HTMLDivElement>) => {
    // Soltar un arrastre (p. ej. seleccionando texto) sobre el fondo no cierra.
    if (presionEnFondoRef.current && e.target === e.currentTarget) cerrar();
    presionEnFondoRef.current = false;
  };

  // En edición, el propio registro sale como "registrado": no es un choque.
  const yaRegistrado =
    resultado?.registrado && resultado.registrado.id !== registro?.id
      ? resultado.registrado
      : duplicado;

  const puedeAgregarExtra = extras.length + 1 < TELEFONOS_MAX;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-6"
      onMouseDown={alPresionarFondo}
      onClick={alSoltarEnFondo}
    >
      <div
        ref={dialogoRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cd-titulo"
        className="w-full sm:max-w-lg max-h-[92vh] sm:max-h-[85vh] flex flex-col bg-[#0a101c] border border-white/10 sm:rounded-2xl rounded-t-2xl shadow-2xl shadow-black/60"
      >
        <form onSubmit={guardar} className="flex flex-col min-h-0">
          {/* Encabezado */}
          <div className="flex items-center gap-3 px-5 py-4 border-b border-white/10">
            <div className="min-w-0">
              <h2 id="cd-titulo" className="text-base font-black text-white">
                {esAlta ? "Nuevo cliente con descuento" : "Editar cliente con descuento"}
              </h2>
              <p className={cn(lbl, "mt-0.5")}>
                {esAlta
                  ? "Captura el celular y búscalo en el catálogo; lo demás es opcional"
                  : `Alta: ${fechaCorta(registro?.creadoEn)}${registro?.creadoPor ? ` · ${registro.creadoPor}` : ""}${registro?.idClienteApv != null ? ` · ID APV ${registro.idClienteApv}` : ""}`}
              </p>
            </div>
            <button
              type="button"
              onClick={cerrar}
              disabled={guardando}
              aria-label="Cerrar"
              className="ml-auto p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/[0.06] transition-all disabled:opacity-40"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Campos */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            <div>
              <label htmlFor="cd-telefono" className={lbl}>
                Celular (WhatsApp)
              </label>
              <div className="mt-1 flex gap-2">
                <input
                  id="cd-telefono"
                  ref={telefonoRef}
                  type="tel"
                  inputMode="numeric"
                  autoComplete="off"
                  value={telefono}
                  onChange={(e) => cambiarTelefono(e.target.value)}
                  onBlur={alSalirTelefono}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void buscar(true);
                    }
                  }}
                  placeholder="10 dígitos · opcional"
                  className={cn(inputCls, "font-mono tabular-nums")}
                />
                <button
                  type="button"
                  onClick={() => void buscar(true)}
                  disabled={buscando}
                  className={cn(btnSecundario, "shrink-0")}
                >
                  {buscando ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Search className="h-3.5 w-3.5" />
                  )}
                  Buscar
                </button>
              </div>
              {errorBusqueda && (
                <p className="mt-1.5 text-[11px] font-bold text-rose-300">{errorBusqueda}</p>
              )}
            </div>

            {yaRegistrado ? (
              <Aviso tono="ambar" icono={<AlertTriangle className="h-4 w-4" />}>
                Ese celular ya es de <b>{yaRegistrado.cliente}</b> con{" "}
                {porcentaje(yaRegistrado.descuento)}.{" "}
                <button
                  type="button"
                  onClick={() => onEditarExistente(yaRegistrado)}
                  className="font-black underline underline-offset-2 hover:text-white"
                >
                  Editar ese registro
                </button>
              </Aviso>
            ) : resultado?.enBdav ? (
              <Aviso tono="verde" icono={<CheckCircle2 className="h-4 w-4" />}>
                Encontrado en el catálogo de clientes: <b>{resultado.enBdav.nombre}</b> · descuento{" "}
                {porcentaje(resultado.enBdav.descuento)}
                {!resultado.enBdav.exacto &&
                  ` · coincidencia aproximada: en el catálogo está como “${resultado.enBdav.telefono}”`}
                {resultado.coincidencias > 1 &&
                  ` · ${resultado.coincidencias} coincidencias, se tomó la más reciente`}
                {resultado.enBdav.activo === 0 && " · cliente inactivo"}
              </Aviso>
            ) : resultado?.catalogoNoDisponible ? (
              <Aviso tono="rojo" icono={<AlertTriangle className="h-4 w-4" />}>
                No se pudo consultar el catálogo de clientes; captura los datos a mano.
                {esAlta && ` Descuento sugerido: ${porcentaje(resultado.descuentoDefault)}.`}
              </Aviso>
            ) : resultado ? (
              <Aviso tono="gris" icono={<Info className="h-4 w-4" />}>
                {esAlta
                  ? `No está en el catálogo de clientes: captura el nombre. Descuento sugerido: ${porcentaje(resultado.descuentoDefault)}.`
                  : "No está en el catálogo de clientes: se conservan los datos capturados."}
              </Aviso>
            ) : null}

            {/* Celulares adicionales: el mismo cliente escribe desde varios números */}
            <div>
              <div className="flex items-center justify-between gap-3">
                <span className={lbl}>Otros celulares de WhatsApp</span>
                <button
                  type="button"
                  onClick={agregarExtra}
                  disabled={!puedeAgregarExtra}
                  className="flex items-center gap-1 text-[11px] font-black uppercase tracking-widest text-amber-300 hover:text-white transition-colors disabled:opacity-40"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Agregar celular
                </button>
              </div>
              {extras.length === 0 ? (
                <p className="mt-1 text-[11px] font-bold text-slate-600">
                  Todos los celulares del cliente lo identifican en WhatsApp.
                </p>
              ) : (
                <div className="mt-1 space-y-2">
                  {extras.map((extra, i) => (
                    <div key={extra.id} className="flex gap-2">
                      <input
                        type="tel"
                        inputMode="numeric"
                        autoComplete="off"
                        aria-label={`Celular adicional ${i + 1}`}
                        value={extra.valor}
                        onChange={(e) => cambiarExtra(extra.id, e.target.value)}
                        placeholder="10 dígitos"
                        className={cn(inputCls, "font-mono tabular-nums")}
                      />
                      <button
                        type="button"
                        onClick={() => quitarExtra(extra.id)}
                        aria-label={`Quitar el celular adicional ${i + 1}`}
                        title="Quitar"
                        className="shrink-0 p-2.5 rounded-xl border border-white/10 text-slate-400 hover:text-rose-300 hover:bg-white/[0.06] transition-all"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label htmlFor="cd-cliente" className={lbl}>
                Cliente
              </label>
              <input
                id="cd-cliente"
                type="text"
                maxLength={150}
                autoComplete="off"
                value={cliente}
                onChange={(e) => cambiarCliente(e.target.value)}
                placeholder="Nombre del cliente"
                className={cn(inputCls, "mt-1")}
              />
            </div>

            <div className="flex flex-wrap items-end gap-6">
              <div>
                <label htmlFor="cd-descuento" className={lbl}>
                  Descuento
                </label>
                <div className="relative mt-1 w-40">
                  <input
                    id="cd-descuento"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={100}
                    step={0.01}
                    value={descuento}
                    onChange={(e) => cambiarDescuento(e.target.value)}
                    className={cn(inputCls, "pr-9 tabular-nums")}
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-black text-slate-500">
                    %
                  </span>
                </div>
              </div>
              <label className="flex items-center gap-2.5 pb-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={permitirPedido}
                  onChange={(e) => setPermitirPedido(e.target.checked)}
                  className="h-4 w-4 rounded accent-amber-400"
                />
                <span className="text-sm font-bold text-slate-200">Permitir pedido</span>
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="cd-rfc" className={lbl}>
                  RFC
                </label>
                <input
                  id="cd-rfc"
                  type="text"
                  maxLength={13}
                  autoComplete="off"
                  value={rfc}
                  onChange={(e) => setRfc(e.target.value.toUpperCase())}
                  placeholder="12 o 13 caracteres"
                  className={cn(inputCls, "mt-1 font-mono uppercase")}
                />
              </div>
              <div>
                <label htmlFor="cd-telefono2" className={lbl}>
                  Otros teléfonos
                </label>
                <input
                  id="cd-telefono2"
                  type="text"
                  maxLength={60}
                  autoComplete="off"
                  value={telefono2}
                  onChange={(e) => setTelefono2(e.target.value)}
                  placeholder="Fijo, oficina…"
                  className={cn(inputCls, "mt-1")}
                />
              </div>
            </div>

            <div>
              <label htmlFor="cd-email" className={lbl}>
                Email
              </label>
              <input
                id="cd-email"
                type="text"
                inputMode="email"
                maxLength={120}
                autoComplete="off"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="correo@dominio.com"
                className={cn(inputCls, "mt-1")}
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 bg-rose-500/10 border border-rose-500/25 rounded-xl p-3 text-rose-300 text-sm font-bold">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {error}
              </div>
            )}
          </div>

          {/* Acciones */}
          <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-white/10">
            <button type="button" onClick={cerrar} disabled={guardando} className={btnSecundario}>
              Cancelar
            </button>
            <button
              type="submit"
              disabled={guardando || buscando || Boolean(yaRegistrado)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500 text-slate-950 text-[11px] font-black uppercase tracking-widest hover:brightness-110 transition-all disabled:opacity-40"
            >
              {guardando && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {esAlta ? "Dar de alta" : "Guardar cambios"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
