import { NextResponse } from "next/server";
import { credencialParaRuta } from "@/lib/agente-modelo";
import { exigirKiosco } from "@/lib/auth-kiosco";
import { guardarIntercambio } from "@/lib/db-conversaciones";
import { obtenerBorrador } from "@/lib/db-pedidos";
import { fotosDeRespuesta, separarMarcadorFotos } from "@/lib/fotos-respuesta";
import {
  CANAL_KIOSCO,
  ERROR_CUPO_VICO,
  LIMITE_VICO_KIOSCO,
  actorCapturaKiosco,
  actorVicoKiosco,
  crearCupo,
  pedidoParaKiosco,
  productoParaKiosco,
} from "@/lib/kiosco-api";
import { crearMemoriaConversacion } from "@/lib/memoria-conversacion";
import { productosMencionados } from "@/lib/productos-mencionados";
import { baseUrlPublica } from "@/lib/url-publica";
import { correrVendedor } from "@/lib/vendedor";

// Vico en el kiosco de autoservicio: "¿No sabes cómo se llama la pieza?
// Pregúntale a Vico". Es el mismo agente del mostrador con el actor 'kiosco',
// que solo le da las tres herramientas de armar el pedido: MANDARLO es el
// botón de la pantalla (y por eso el prompt le prohíbe decir que quedó
// registrado). Precio de mostrador siempre: el kiosco no conoce el padrón.
//
// La respuesta va recortada igual que el resto de /api/kiosco/*: los productos
// sin existencia exacta y el pedido sin id, bitácora ni datos del POS.

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_MENSAJE = 2000;
const RESPUESTA_VACIA = "Disculpa, no te entendí. ¿Qué pieza buscas?";

// Memoria de conversación por APARATO (k:<kiosco>) y tope por minuto, en
// proceso: la conversación es de la pantalla, no de una persona, y por eso se
// olvida completa cuando el cliente termina (reiniciar = true).
const memoria = crearMemoriaConversacion();
const cupo = crearCupo(LIMITE_VICO_KIOSCO);

interface CuerpoVico {
  mensaje: string;
  reiniciar: boolean;
}

type Validacion = { ok: true; datos: CuerpoVico } | { ok: false; error: string };

function validarCuerpo(entrada: unknown): Validacion {
  if (typeof entrada !== "object" || entrada === null || Array.isArray(entrada)) {
    return { ok: false, error: "Petición inválida" };
  }
  const { mensaje, reiniciar } = entrada as Record<string, unknown>;
  const mensajeLimpio = typeof mensaje === "string" ? mensaje.trim().slice(0, MAX_MENSAJE) : "";
  if (!mensajeLimpio) return { ok: false, error: "Falta el mensaje" };
  return { ok: true, datos: { mensaje: mensajeLimpio, reiniciar: reiniciar === true } };
}

/** Clave de memoria y de bitácora del aparato: la misma del borrador. */
function claveDe(kiosco: string): string {
  return `k:${kiosco}`;
}

export async function POST(request: Request) {
  const guardia = await exigirKiosco(request);
  if (!guardia.ok) return guardia.respuesta;
  const { kiosco } = guardia;

  // Proveedor, modelo y llave de Vico salen de HL Servidor (HL_AGENTE_VICO).
  const ia = await credencialParaRuta("vico");
  if (!ia.ok) return NextResponse.json({ ok: false, error: ia.error }, { status: 503 });
  const { credencial } = ia;

  let cuerpo: unknown;
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Petición inválida" }, { status: 400 });
  }
  const validacion = validarCuerpo(cuerpo);
  if (!validacion.ok) return NextResponse.json({ ok: false, error: validacion.error }, { status: 400 });
  const { mensaje, reiniciar } = validacion.datos;

  const clave = claveDe(kiosco.kiosco);
  if (reiniciar) memoria.olvidar(clave);
  if (!cupo.intentar(kiosco.kiosco)) {
    return NextResponse.json({ ok: false, error: ERROR_CUPO_VICO }, { status: 429 });
  }

  const actor = actorVicoKiosco(kiosco);

  try {
    // Códigos que el agente consultó (para adjuntar las fotos que mencione),
    // fotos públicas de las usadas y los resultados crudos del turno, de donde
    // salen los renglones con botón "Agregar" de la pantalla.
    const codigosConsultados = new Set<string>();
    const fotosUsadas = new Map<string, string>();
    const resultadosPorHerramienta: Array<{ herramienta: string; resultados: unknown[] }> = [];

    const respuesta = await correrVendedor({
      pregunta: mensaje,
      historial: memoria.historialDe(clave),
      credencial,
      // Sin imágenes inline: las fotos van aparte, como en el mostrador.
      canal: "whatsapp",
      // Precio de mostrador: en el kiosco no hay descuento de padrón.
      descuentoCliente: null,
      actor,
      alCodigos: (codigos) => codigos.forEach((c) => codigosConsultados.add(c)),
      alFotosUsadas: (fotos) => fotos.forEach((f) => fotosUsadas.set(f.codigo.toUpperCase(), f.url)),
      alResultados: (herramienta, resultados) => resultadosPorHerramienta.push({ herramienta, resultados }),
    });
    const { texto: limpio, codigosMarcados } = separarMarcadorFotos(respuesta);
    const texto = limpio || RESPUESTA_VACIA;
    memoria.guardarTurno(clave, mensaje, texto);

    const fotos = await fotosDeRespuesta({
      codigosMarcados,
      codigosConsultados,
      fotosUsadas,
      base: baseUrlPublica(request),
    });
    // Se ordena con la respuesta completa (marcador incluido) para que cuente
    // como mencionado también lo que Vico solo puso en [[FOTOS: ...]].
    const productos = productosMencionados({ resultadosPorHerramienta, texto: respuesta, fotos });

    // El pedido tras el turno (Vico pudo haberle agregado piezas). Si la
    // lectura falla, la respuesta sale igual: la pantalla lo pide aparte.
    const borrador = await obtenerBorrador(actorCapturaKiosco(kiosco)).catch((error) => {
      console.error("[kiosco-vico] no se pudo leer el pedido tras el turno:", error);
      return null;
    });

    // Bitácora en BDVidaurriConversaciones (fire-and-forget: si falla, la
    // respuesta al cliente sale de todas formas).
    void guardarIntercambio({
      telefono: clave,
      canal: CANAL_KIOSCO,
      mensajeCliente: mensaje,
      respuestaVendedor: texto,
      fotos: fotos.map((f) => f.url),
    }).catch((error) => {
      console.error("[kiosco-vico] no se pudo guardar la conversación en la bitácora:", error);
    });

    return NextResponse.json({
      ok: true,
      respuesta: texto,
      fotos,
      productos: productos.map(productoParaKiosco),
      pedido: pedidoParaKiosco(borrador),
    });
  } catch (error) {
    console.error("Error en Vendedor IA (kiosco):", error);
    return NextResponse.json({ ok: false, error: "No fue posible responder en este momento" }, { status: 502 });
  }
}
