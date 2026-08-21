import crypto from "node:crypto";
import { claveFaltante } from "@/lib/agente-modelo";
import { correrVendedor, type MensajeConversacion } from "@/lib/vendedor";
import { urlFotoAldo, fotoAldoExiste } from "@/lib/aldo";
import { guardarIntercambio, ES_SESION_WEB } from "@/lib/db-conversaciones";

// Webservice del Vendedor IA para WhatsApp. A diferencia del canal web (que usa
// la cookie de sesión), este se autentica con una API key (WHATSAPP_API_KEY) y
// devuelve UNA respuesta completa en texto plano (WhatsApp no hace streaming).
// El gateway de WhatsApp (Twilio, Cloud API, n8n, whatsapp-web.js…) llama aquí
// con el teléfono y el mensaje del cliente, y reenvía la respuesta al chat.

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_MENSAJE = 2000;
const MAX_HISTORIAL = 12; // mensajes recordados por conversación
const TTL_CONVERSACION_MS = 30 * 60 * 1000; // 30 min de inactividad
const LIMITE_POR_MINUTO = 20;

// Memoria de conversación por número de teléfono (para que el chat tenga contexto).
const conversaciones = new Map<string, { mensajes: MensajeConversacion[]; expira: number }>();
// Rate limit por teléfono.
const ventanas = new Map<string, number[]>();

function comparaClaveSegura(recibida: string, esperada: string): boolean {
  const a = Buffer.from(recibida);
  const b = Buffer.from(esperada);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function autorizado(request: Request): boolean {
  const esperada = process.env.WHATSAPP_API_KEY;
  if (!esperada) return false; // sin key configurada, el webservice queda cerrado
  const bearer = request.headers.get("authorization") ?? "";
  const recibida = bearer.toLowerCase().startsWith("bearer ")
    ? bearer.slice(7).trim()
    : (request.headers.get("x-api-key") ?? "").trim();
  if (!recibida) return false;
  return comparaClaveSegura(recibida, esperada);
}

// Fotos: se entregan por el proxy propio /api/whatsapp/foto con una marca
// ÚNICA DENTRO DE LA RUTA. Sin esto, la pasarela de WhatsApp reenviaba la
// imagen cacheada del producto anterior (con el pie de foto del nuevo); un
// `?v=` no basta porque hay cachés que solo consideran la ruta.
const BASES_FOTO = [
  { prefijo: "https://s3-us-west-2.amazonaws.com/aldoautopartesproductos/", origen: "aldo" },
  { prefijo: "https://sistema.apvidaurri.com/imagenes_piezas/", origen: "usadas" },
];

/** Origen público del sistema, para armar URLs absolutas que WhatsApp pueda bajar. */
function baseUrlPublica(request: Request): string {
  const configurada = process.env.PUBLIC_BASE_URL?.trim().replace(/\/+$/, "");
  if (configurada) return configurada;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";
  if (!host) return "";
  // WhatsApp exige HTTPS para los medios; el host público ya redirige a HTTPS.
  const protocolo = request.headers.get("x-forwarded-proto") ?? "https";
  return `${protocolo}://${host}`;
}

/** Convierte la URL original de la foto en una del proxy, con ruta única. */
// El proxy es lo que pone la marca de agua: una URL que no pase por él sale del
// origen tal cual, sin sello. Se sigue mandando —mejor foto sin marca que pieza
// sin foto—, pero queda registrado: si esto se repite, el catálogo entero se
// está publicando sin marca y nadie se entera.
function urlFotoWhatsapp(urlOriginal: string, base: string, marca: string): string {
  if (base) {
    for (const { prefijo, origen } of BASES_FOTO) {
      if (urlOriginal.startsWith(prefijo)) {
        const archivo = decodeURIComponent(urlOriginal.slice(prefijo.length).split("?")[0]);
        return `${base}/api/whatsapp/foto/${marca}/${origen}/${encodeURIComponent(archivo)}`;
      }
    }
  }
  console.warn(
    `[foto-whatsapp] se manda SIN marca de agua (no pasa por el proxy): ${
      base ? "origen desconocido" : "falta PUBLIC_BASE_URL y no hay host en la petición"
    } -> ${urlOriginal}`
  );
  return urlOriginal;
}

function excedeLimite(telefono: string): boolean {
  const ahora = Date.now();
  const ventana = (ventanas.get(telefono) ?? []).filter((t) => ahora - t < 60_000);
  if (ventana.length >= LIMITE_POR_MINUTO) return true;
  ventana.push(ahora);
  ventanas.set(telefono, ventana);
  return false;
}

function historialDe(telefono: string): MensajeConversacion[] {
  const conv = conversaciones.get(telefono);
  if (!conv || conv.expira < Date.now()) return [];
  return conv.mensajes;
}

function guardarTurno(telefono: string, pregunta: string, respuesta: string): void {
  const previos = historialDe(telefono);
  const mensajes = [
    ...previos,
    { rol: "usuario" as const, texto: pregunta },
    { rol: "agente" as const, texto: respuesta },
  ].slice(-MAX_HISTORIAL);
  conversaciones.set(telefono, { mensajes, expira: Date.now() + TTL_CONVERSACION_MS });
}

/** Salud del webservice (sin exponer datos). Útil para probar conectividad. */
export function GET() {
  return Response.json({ ok: true, servicio: "vendedor-ia-whatsapp" });
}

export async function POST(request: Request) {
  if (!autorizado(request)) {
    return Response.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  const modelo = process.env.VENDEDOR_MODELO || "claude-sonnet-5";
  if (claveFaltante(modelo)) {
    return Response.json(
      { ok: false, error: "Servicio de IA no configurado" },
      { status: 500 }
    );
  }

  let cuerpo: { telefono?: string; mensaje?: string; reiniciar?: boolean };
  try {
    cuerpo = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Petición inválida" }, { status: 400 });
  }

  // El teléfono identifica la conversación; se saneé para usarlo de clave.
  const telefono = String(cuerpo.telefono ?? "").replace(/[^\d+]/g, "").slice(0, 20) || "anon";
  const mensaje = String(cuerpo.mensaje ?? "").trim().slice(0, MAX_MENSAJE);

  if (cuerpo.reiniciar) conversaciones.delete(telefono);
  if (!mensaje) {
    return Response.json({ ok: false, error: "Falta el mensaje" }, { status: 400 });
  }
  if (excedeLimite(telefono)) {
    return Response.json(
      { ok: false, error: "Demasiados mensajes seguidos; espera un momento" },
      { status: 429 }
    );
  }

  try {
    // Códigos que el agente consultó (para adjuntar las fotos que mencione) y
    // fotos públicas de las piezas usadas encontradas (código → URL).
    const codigosConsultados = new Set<string>();
    const fotosUsadas = new Map<string, string>();
    const respuesta = await correrVendedor({
      pregunta: mensaje,
      historial: historialDe(telefono),
      modelo,
      alCodigos: (codigos) => codigos.forEach((c) => codigosConsultados.add(c)),
      alFotosUsadas: (fotos) =>
        fotos.forEach((f) => fotosUsadas.set(f.codigo.toUpperCase(), f.url)),
    });
    // El agente marca los productos sugeridos con [[FOTOS: cod1, cod2]] al final;
    // se extraen los códigos y se quita esa línea técnica del texto visible.
    const marcador = respuesta.match(/\[\[FOTOS:\s*([^\]]*)\]\]/i);
    const texto =
      respuesta.replace(/\[\[FOTOS:[^\]]*\]\]/gi, "").trim() ||
      "Disculpa, no te entendí. ¿Qué parte buscas?";
    guardarTurno(telefono, mensaje, texto);

    // Solo se aceptan códigos REALES (que el catálogo devolvió) y con foto en S3,
    // para no mandar enlaces inventados ni rotos por WhatsApp.
    const reales = new Map(
      [...codigosConsultados].map((c) => [c.toUpperCase(), c] as const)
    );
    const pedidos = (marcador?.[1] ?? "")
      .split(",")
      .map((c) => reales.get(c.trim().toUpperCase()))
      .filter((c): c is string => Boolean(c))
      .slice(0, 3);
    // Pieza usada: su foto ya viene con URL pública de la bodega. Producto
    // nuevo: se verifica que exista en el S3 de Aldo antes de adjuntarla.
    const verificadas = await Promise.all(
      pedidos.map(async (codigo) => {
        const urlUsada = fotosUsadas.get(codigo.toUpperCase());
        if (urlUsada) return { codigo, url: urlUsada };
        return { codigo, url: (await fotoAldoExiste(codigo)) ? urlFotoAldo(codigo) : null };
      })
    );
    // Marca única por respuesta: evita que la pasarela reenvíe una foto cacheada.
    const marca = `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
    const base = baseUrlPublica(request);
    const fotos = verificadas
      .filter((f): f is { codigo: string; url: string } => Boolean(f.url))
      .map((f) => ({ codigo: f.codigo, url: urlFotoWhatsapp(f.url, base, marca) }));

    // Bitácora en BDVidaurriConversaciones (fire-and-forget: si la base de
    // conversaciones falla, la respuesta al cliente sale de todas formas).
    void guardarIntercambio({
      telefono,
      // El chat de la página entra por este mismo webservice con una sesión
      // sintética 77…: en la bitácora debe quedar como canal web, no WhatsApp.
      canal: ES_SESION_WEB.test(telefono) ? "web" : "whatsapp",
      mensajeCliente: mensaje,
      respuestaVendedor: texto,
      fotos: fotos.map((f) => f.url),
    }).catch((error) => {
      console.error("No se pudo guardar la conversación en la bitácora:", error);
    });

    return Response.json({ ok: true, respuesta: texto, fotos });
  } catch (error) {
    console.error("Error en Vendedor IA (WhatsApp):", error);
    return Response.json(
      { ok: false, error: "No fue posible responder en este momento" },
      { status: 502 }
    );
  }
}
