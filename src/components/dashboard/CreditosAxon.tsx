"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  ShieldCheck,
  ShoppingCart,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { entero, moneda } from "@/lib/formato";
import type { CatalogoPacksAxon, PackAxon, SaldoAxon } from "@/lib/axon-creditos";

// Créditos de WhatsApp: saldo de tokens de la cuenta en Axon Logic y compra de
// packs vía Stripe. Un token = una conversación de 24 h con un cliente. Sigue
// las recomendaciones de la guía de Axon: refresco cada 5 min, alerta cuando
// quedan menos de 7 días y saldo fresco (sin caché) al volver de un pago.

export type EstadoPago = "ok" | "cancelado" | null;

const lbl = "text-[10px] font-black text-slate-500 uppercase tracking-widest";
const tarjeta = "bg-white/[0.02] border border-white/10 rounded-2xl p-4";
const btnSecundario =
  "flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/[0.05] border border-white/10 text-slate-300 text-[11px] font-black uppercase tracking-widest hover:text-amber-300 transition-all disabled:opacity-40";
const btnPrimario =
  "flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500 text-slate-950 text-[11px] font-black uppercase tracking-widest hover:brightness-110 transition-all disabled:opacity-40";

const REFRESCO_MS = 5 * 60_000;
/** Con menos días de saldo que esto, Axon sugiere avisar que hay que comprar. */
const DIAS_ALERTA = 7;
const DIAS_AVISO = 15;

const fmtDecimal = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 1 });

/** ISO UTC → '02/09/26, 12:15' en la zona del navegador. */
function fechaHora(iso: string): string {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return iso;
  return fecha.toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" });
}

interface RespuestaSaldo {
  clave: number;
  saldo: SaldoAxon | null;
  error: string;
  sinConfigurar: boolean;
}

interface RespuestaPacks {
  catalogo: CatalogoPacksAxon | null;
  error: string;
}

interface CuerpoSaldo {
  saldo?: SaldoAxon;
  error?: string;
  sinConfigurar?: boolean;
}

interface CuerpoPacks {
  catalogo?: CatalogoPacksAxon;
  error?: string;
}

interface CuerpoCheckout {
  checkout?: { checkoutUrl: string };
  error?: string;
}

function mensajeDe(err: unknown, respaldo: string): string {
  return err instanceof Error ? err.message : respaldo;
}

export function CreditosAxon({ pago }: { pago: EstadoPago }) {
  const router = useRouter();
  /** Se incrementa para volver a consultar (botón y refresco automático). */
  const [version, setVersion] = useState(0);
  const [saldoResp, setSaldoResp] = useState<RespuestaSaldo | null>(null);
  const [packsResp, setPacksResp] = useState<RespuestaPacks | null>(null);
  const [avisoPago, setAvisoPago] = useState<EstadoPago>(pago);
  /** id del pack cuya sesión de pago se está abriendo. */
  const [comprando, setComprando] = useState<string | null>(null);
  const [errorCompra, setErrorCompra] = useState("");

  // Saldo: una consulta por versión; la respuesta de una consulta vieja que
  // llegue tarde se descarta. Al volver de un pago se salta la caché.
  useEffect(() => {
    let cancelado = false;
    const forzar = version === 0 && pago === "ok";
    (async () => {
      let resultado: RespuestaSaldo;
      try {
        const res = await fetch(`/api/axon/saldo${forzar ? "?forzar=1" : ""}`);
        if (res.status === 401) {
          router.push("/login");
          return;
        }
        const cuerpo = (await res.json().catch(() => null)) as CuerpoSaldo | null;
        resultado =
          res.ok && cuerpo?.saldo
            ? { clave: version, saldo: cuerpo.saldo, error: "", sinConfigurar: false }
            : {
                clave: version,
                saldo: null,
                error: cuerpo?.error ?? "No se pudo consultar el saldo",
                sinConfigurar: cuerpo?.sinConfigurar === true,
              };
      } catch (err: unknown) {
        resultado = {
          clave: version,
          saldo: null,
          error: mensajeDe(err, "No se pudo consultar el saldo"),
          sinConfigurar: false,
        };
      }
      if (!cancelado) setSaldoResp(resultado);
    })();
    return () => {
      cancelado = true;
    };
  }, [version, pago, router]);

  // Packs: el catálogo casi no cambia (el servidor lo cachea 10 min).
  useEffect(() => {
    let cancelado = false;
    (async () => {
      let resultado: RespuestaPacks;
      try {
        const res = await fetch("/api/axon/packs");
        if (res.status === 401) {
          router.push("/login");
          return;
        }
        const cuerpo = (await res.json().catch(() => null)) as CuerpoPacks | null;
        resultado =
          res.ok && cuerpo?.catalogo
            ? { catalogo: cuerpo.catalogo, error: "" }
            : { catalogo: null, error: cuerpo?.error ?? "No se pudo consultar los packs" };
      } catch (err: unknown) {
        resultado = { catalogo: null, error: mensajeDe(err, "No se pudo consultar los packs") };
      }
      if (!cancelado) setPacksResp(resultado);
    })();
    return () => {
      cancelado = true;
    };
  }, [version, router]);

  // Refresco automático, como recomienda Axon para el widget de saldo.
  useEffect(() => {
    const temporizador = setInterval(() => setVersion((v) => v + 1), REFRESCO_MS);
    return () => clearInterval(temporizador);
  }, []);

  const comprar = async (pack: PackAxon) => {
    setComprando(pack.id);
    setErrorCompra("");
    try {
      const res = await fetch("/api/axon/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packId: pack.id }),
      });
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      const cuerpo = (await res.json().catch(() => null)) as CuerpoCheckout | null;
      if (!res.ok || !cuerpo?.checkout) {
        throw new Error(cuerpo?.error ?? "No se pudo iniciar la compra");
      }
      // Se va a Stripe: el spinner se queda hasta que cambie la página.
      window.location.assign(cuerpo.checkout.checkoutUrl);
    } catch (err: unknown) {
      setErrorCompra(mensajeDe(err, "No se pudo iniciar la compra"));
      setComprando(null);
    }
  };

  const cerrarAvisoPago = () => {
    setAvisoPago(null);
    router.replace("/dashboard/axon");
  };

  const cargando = saldoResp?.clave !== version;
  // Mientras llega la consulta nueva se sigue mostrando el saldo anterior.
  const saldo = saldoResp?.saldo ?? null;
  const errorSaldo = saldoResp?.clave === version ? saldoResp.error : "";
  const sinConfigurar = saldoResp?.sinConfigurar === true;
  const dias = saldo?.diasRestantes ?? null;
  const saldoBajo = dias !== null && dias < DIAS_ALERTA;
  const colorDias =
    dias === null
      ? "text-slate-300"
      : dias < DIAS_ALERTA
        ? "text-rose-300"
        : dias < DIAS_AVISO
          ? "text-amber-300"
          : "text-emerald-300";

  const tarjetas = saldo
    ? [
        {
          titulo: "Saldo disponible",
          valor: entero(saldo.saldo),
          unidad: "tokens",
          color: saldoBajo ? "text-rose-300" : "text-amber-300",
        },
        {
          titulo: "Consumo últimos 30 días",
          valor: entero(saldo.consumidos30d),
          unidad: "tokens",
          color: "text-slate-200",
        },
        {
          titulo: "Ritmo diario",
          valor: fmtDecimal.format(saldo.ritmoDiario),
          unidad: "tokens / día",
          color: "text-cyan-300",
        },
        {
          titulo: "Días restantes",
          valor: dias === null ? "—" : entero(Math.round(dias)),
          unidad: dias === null ? "sin consumo aún" : "al ritmo actual",
          color: colorDias,
        },
      ]
    : [];

  const packs = packsResp?.catalogo?.packs ?? [];

  return (
    <div className="space-y-4">
      {/* Encabezado */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight">Créditos de WhatsApp</h1>
          <p className={cn(lbl, "mt-1")}>
            Tokens de la cuenta en Axon Logic · un token = una conversación de 24 h con un cliente
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setVersion((v) => v + 1)}
            disabled={cargando}
            className={btnSecundario}
          >
            {cargando ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Actualizar
          </button>
          <a href="#packs" className={btnPrimario}>
            <ShoppingCart className="h-3.5 w-3.5" />
            Comprar tokens
          </a>
        </div>
      </div>

      {avisoPago === "ok" && (
        <div
          role="status"
          className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/25 rounded-2xl p-4 text-emerald-300 text-sm font-bold"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span className="flex-1">Pago recibido. Los tokens ya están acreditados en el saldo.</span>
          <button
            onClick={cerrarAvisoPago}
            aria-label="Cerrar aviso"
            className="p-1 rounded-lg hover:bg-white/[0.06]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      {avisoPago === "cancelado" && (
        <div
          role="status"
          className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/25 rounded-2xl p-4 text-amber-300 text-sm font-bold"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="flex-1">Compra cancelada. No se hizo ningún cargo.</span>
          <button
            onClick={cerrarAvisoPago}
            aria-label="Cerrar aviso"
            className="p-1 rounded-lg hover:bg-white/[0.06]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {sinConfigurar && (
        <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/25 rounded-2xl p-4 text-amber-300 text-sm font-bold">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Falta configurar AXON_API_KEY en el servidor: pon la key de Axon Logic en el .env y
          reinicia la aplicación.
        </div>
      )}
      {errorSaldo && !sinConfigurar && (
        <div className="flex items-center gap-2 bg-rose-500/10 border border-rose-500/25 rounded-2xl p-4 text-rose-300 text-sm font-bold">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {errorSaldo}
        </div>
      )}
      {saldoBajo && (
        <div className="flex items-center gap-2 bg-rose-500/10 border border-rose-500/25 rounded-2xl p-4 text-rose-300 text-sm font-bold">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Al ritmo actual los tokens se acaban en menos de {DIAS_ALERTA} días: sin saldo, el
          Vendedor IA deja de contestar por WhatsApp. Compra un pack para no quedarte sin servicio.
        </div>
      )}

      {/* Tarjetas de saldo */}
      {saldo ? (
        <div className="space-y-2">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {tarjetas.map((t) => (
              <div key={t.titulo} className={tarjeta}>
                <p className={lbl}>{t.titulo}</p>
                <p className={cn("mt-2 text-2xl font-black tabular-nums", t.color)}>{t.valor}</p>
                <p className="text-[11px] font-bold text-slate-500">{t.unidad}</p>
              </div>
            ))}
          </div>
          <p className="text-[11px] font-bold text-slate-500">
            Comprados en total: {entero(saldo.creditosHistoricos)} tokens · calculado por Axon el{" "}
            {fechaHora(saldo.actualizadoEn)}
          </p>
        </div>
      ) : (
        !errorSaldo &&
        !sinConfigurar && (
          <div className={cn(tarjeta, "flex items-center gap-2 text-slate-400 text-sm font-bold")}>
            <Loader2 className="h-4 w-4 animate-spin" />
            Consultando el saldo en Axon Logic…
          </div>
        )
      )}

      {/* Packs */}
      <div id="packs" className="space-y-3 pt-2">
        <div>
          <h2 className="text-lg font-black text-white tracking-tight">Comprar tokens</h2>
          <p className={cn(lbl, "mt-1")}>Packs con precio vigente en Axon Logic</p>
        </div>

        {errorCompra && (
          <div className="flex items-center gap-2 bg-rose-500/10 border border-rose-500/25 rounded-2xl p-4 text-rose-300 text-sm font-bold">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {errorCompra}
          </div>
        )}

        {packsResp?.error && !sinConfigurar && (
          <div className="flex items-center gap-2 bg-rose-500/10 border border-rose-500/25 rounded-2xl p-4 text-rose-300 text-sm font-bold">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {packsResp.error}
          </div>
        )}

        {packs.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {packs.map((p) => (
              <div
                key={p.id}
                className={cn(
                  tarjeta,
                  "relative flex flex-col gap-3",
                  p.destacado && "border-amber-500/40 bg-amber-500/[0.04]"
                )}
              >
                {p.destacado && (
                  <span className="absolute -top-2.5 right-4 px-2 py-0.5 rounded-full bg-amber-500 text-slate-950 text-[9px] font-black uppercase tracking-widest">
                    Más popular
                  </span>
                )}
                <div>
                  <p className={lbl}>{p.nombre}</p>
                  <p className="mt-1 text-2xl font-black text-white tabular-nums">
                    {entero(p.tokens)}{" "}
                    <span className="text-xs font-bold text-slate-500">tokens</span>
                  </p>
                </div>
                <div>
                  <p className="text-lg font-black text-amber-300 tabular-nums">{moneda(p.precioMxn)}</p>
                  {p.precioPorTokenMxn !== null && (
                    <p className="text-[11px] font-bold text-slate-500">
                      {moneda(p.precioPorTokenMxn)} por token
                    </p>
                  )}
                </div>
                <button
                  onClick={() => void comprar(p)}
                  disabled={comprando !== null}
                  className={cn(p.destacado ? btnPrimario : btnSecundario, "mt-auto justify-center")}
                >
                  {comprando === p.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ShoppingCart className="h-3.5 w-3.5" />
                  )}
                  Comprar
                </button>
              </div>
            ))}
          </div>
        )}

        {!packsResp && !sinConfigurar && (
          <div className={cn(tarjeta, "flex items-center gap-2 text-slate-400 text-sm font-bold")}>
            <Loader2 className="h-4 w-4 animate-spin" />
            Consultando los packs…
          </div>
        )}

        <p className="flex items-start gap-2 text-[11px] font-bold text-slate-500">
          <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-400" />
          <span>
            El pago se hace con tarjeta en una página segura de Stripe. Al terminar, Stripe te
            regresa aquí y los tokens ya están acreditados. Si no completas el pago, la sesión
            caduca sola y no se hace ningún cargo.
          </span>
        </p>
      </div>
    </div>
  );
}
