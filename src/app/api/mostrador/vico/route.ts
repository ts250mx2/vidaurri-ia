import { NextResponse } from "next/server";
import { claveFaltante } from "@/lib/agente-modelo";
import { exigirMostrador } from "@/lib/auth-mostrador";
import { obtenerClienteDescuento } from "@/lib/db-clientes-descuento";
import { guardarIntercambio } from "@/lib/db-conversaciones";
import { obtenerBorrador } from "@/lib/db-pedidos";
import { fotosDeRespuesta, separarMarcadorFotos } from "@/lib/fotos-respuesta";
import { crearMemoriaConversacion } from "@/lib/memoria-conversacion";
import { baseUrlPublica } from "@/lib/url-publica";
import { correrVendedor } from "@/lib/vendedor";
import type { ActorVendedor } from "@/lib/vendedor-pedidos";

// Vico en modo vendedor para el mostrador de vidaurri-page. El vendedor del
// POS (Bearer del mostrador) conversa con Vico para cotizar y levantar el
// pedido del cliente que tiene seleccionado en pantalla; vidaurri-page manda
// ese idCliente en CADA llamada, así que el descuento y el dueño del pedido
// los fija el servidor, nunca el modelo. Devuelve una sola respuesta (sin
// streaming), las fotos como en WhatsApp (proxy sellado) y el borrador actual
// del vendedor tras el turno, para que la pantalla pinte el pedido sin otra
// llamada.

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_MENSAJE = 2000;
const SESION_MAX = 64;
const LIMITE_POR_MINUTO = 20;
const RESPUESTA_VACIA = "Disculpa, no te entendí. ¿Qué pieza buscas?";

// Memoria de conversación por vendedor (m:<usuario>) y rate limit, en proceso.
const memoria = crearMemoriaConversacion();
const ventanas = new Map<string, number[]>();

interface CuerpoVico {
  /** Sesión de chat que abrió la pantalla (para rastrear en bitácora). */
  sesion: string;
  mensaje: string;
  reiniciar: boolean;
  /** Cliente del padrón seleccionado en pantalla; null = público general. */
  idCliente: number | null;
}

type Validacion = { ok: true; datos: CuerpoVico } | { ok: false; error: string };

/** null = público general; undefined = valor inválido. */
function leerIdCliente(crudo: unknown): number | null | undefined {
  if (crudo === null || crudo === undefined || crudo === "") return null;
  const numero = typeof crudo === "string" ? Number(crudo.trim()) : crudo;
  if (typeof numero !== "number" || !Number.isSafeInteger(numero) || numero <= 0) return undefined;
  return numero;
}

function validarCuerpo(entrada: unknown): Validacion {
  if (typeof entrada !== "object" || entrada === null || Array.isArray(entrada)) {
    return { ok: false, error: "Petición inválida" };
  }
  const { sesion, mensaje, reiniciar, idCliente } = entrada as Record<string, unknown>;
  const sesionLimpia = typeof sesion === "string" ? sesion.trim().slice(0, SESION_MAX) : "";
  if (!sesionLimpia) return { ok: false, error: "Falta la sesión" };
  const mensajeLimpio = typeof mensaje === "string" ? mensaje.trim().slice(0, MAX_MENSAJE) : "";
  if (!mensajeLimpio) return { ok: false, error: "Falta el mensaje" };
  const id = leerIdCliente(idCliente);
  if (id === undefined) return { ok: false, error: "Cliente inválido" };
  return {
    ok: true,
    datos: { sesion: sesionLimpia, mensaje: mensajeLimpio, reiniciar: reiniciar === true, idCliente: id },
  };
}

function excedeLimite(clave: string): boolean {
  const ahora = Date.now();
  const ventana = (ventanas.get(clave) ?? []).filter((t) => ahora - t < 60_000);
  if (ventana.length >= LIMITE_POR_MINUTO) return true;
  ventana.push(ahora);
  ventanas.set(clave, ventana);
  return false;
}

/** Clave de memoria y de bitácora del vendedor: m:<usuario>. */
function claveDe(usuario: string): string {
  return `m:${usuario}`;
}

export async function POST(request: Request) {
  const guardia = await exigirMostrador(request);
  if (!guardia.ok) return guardia.respuesta;
  const { sesion } = guardia;

  const modelo = process.env.VENDEDOR_MODELO || "claude-sonnet-5";
  if (claveFaltante(modelo)) {
    return NextResponse.json({ ok: false, error: "Servicio de IA no configurado" }, { status: 500 });
  }

  let cuerpo: unknown;
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Petición inválida" }, { status: 400 });
  }
  const validacion = validarCuerpo(cuerpo);
  if (!validacion.ok) return NextResponse.json({ ok: false, error: validacion.error }, { status: 400 });
  const { mensaje, reiniciar, idCliente } = validacion.datos;

  const clave = claveDe(sesion.usuario);
  if (reiniciar) memoria.olvidar(clave);
  if (excedeLimite(clave)) {
    return NextResponse.json(
      { ok: false, error: "Demasiados mensajes seguidos; espera un momento" },
      { status: 429 }
    );
  }

  // El cliente atendido lo decide la pantalla (idCliente), no el chat: de aquí
  // salen el descuento con el que Vico cotiza y el nombre que va en el pedido.
  let cliente = null;
  if (idCliente !== null) {
    try {
      cliente = await obtenerClienteDescuento(idCliente);
    } catch (error) {
      console.error("[mostrador-vico] no se pudo leer el cliente del padrón:", error);
      return NextResponse.json(
        { ok: false, error: "No fue posible consultar el padrón de clientes" },
        { status: 502 }
      );
    }
    if (!cliente) return NextResponse.json({ ok: false, error: "El cliente no existe en el padrón" }, { status: 404 });
  }
  const actor: ActorVendedor = {
    tipo: "vendedor",
    usuario: sesion.usuario,
    nombre: sesion.nombre || sesion.usuario,
    perfil: sesion.perfil,
    idCliente: cliente?.id ?? null,
    clienteNombre: cliente?.cliente ?? null,
    clienteTelefono: cliente?.telefono ?? null,
    descuento: cliente?.descuento ?? null,
  };

  try {
    // Códigos que el agente consultó (para adjuntar las fotos que mencione) y
    // fotos públicas de las piezas usadas encontradas (código → URL).
    const codigosConsultados = new Set<string>();
    const fotosUsadas = new Map<string, string>();

    const respuesta = await correrVendedor({
      pregunta: mensaje,
      historial: memoria.historialDe(clave),
      modelo,
      // Sin imágenes inline: las fotos van aparte, como en WhatsApp.
      canal: "whatsapp",
      descuentoCliente: actor.descuento,
      actor,
      alCodigos: (codigos) => codigos.forEach((c) => codigosConsultados.add(c)),
      alFotosUsadas: (fotos) => fotos.forEach((f) => fotosUsadas.set(f.codigo.toUpperCase(), f.url)),
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

    // El borrador tras el turno (Vico pudo haberlo tocado). Si la lectura
    // falla, la respuesta sale igual: la pantalla puede pedirlo aparte.
    const pedido = await obtenerBorrador({ tipo: "vendedor", usuario: sesion.usuario }).catch((error) => {
      console.error("[mostrador-vico] no se pudo leer el borrador tras el turno:", error);
      return null;
    });

    // Bitácora en BDVidaurriConversaciones (fire-and-forget: si falla, la
    // respuesta al vendedor sale de todas formas).
    void guardarIntercambio({
      telefono: clave,
      canal: "mostrador",
      mensajeCliente: mensaje,
      respuestaVendedor: texto,
      fotos: fotos.map((f) => f.url),
    }).catch((error) => {
      console.error("[mostrador-vico] no se pudo guardar la conversación en la bitácora:", error);
    });

    return NextResponse.json({ ok: true, respuesta: texto, fotos, pedido });
  } catch (error) {
    console.error("Error en Vendedor IA (mostrador):", error);
    return NextResponse.json(
      { ok: false, error: "No fue posible responder en este momento" },
      { status: 502 }
    );
  }
}
