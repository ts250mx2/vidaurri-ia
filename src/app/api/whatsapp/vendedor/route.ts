import crypto from "node:crypto";
import { claveFaltante } from "@/lib/agente-modelo";
import { correrVendedor } from "@/lib/vendedor";
import { puedePedir, type ActorVendedor } from "@/lib/vendedor-pedidos";
import { ahoraMonterrey, guardarIntercambio, ES_SESION_WEB } from "@/lib/db-conversaciones";
import { obtenerClienteDescuentoPorTelefono } from "@/lib/db-clientes-descuento";
import { obtenerBorrador, ultimosPedidosDeTelefono } from "@/lib/db-pedidos";
import {
  enlacePdfSiSeEnvio,
  notaContextoPedido,
  preguntaConNota,
  textoConEnlacePdf,
  type EnlacePedido,
} from "@/lib/whatsapp-pedidos";
import { fotosDeRespuesta, separarMarcadorFotos } from "@/lib/fotos-respuesta";
import { crearMemoriaConversacion } from "@/lib/memoria-conversacion";
import { normalizarTelefono } from "@/lib/telefono";
import { baseUrlConfigurada, baseUrlPublica } from "@/lib/url-publica";

// Webservice del Vendedor IA para WhatsApp. A diferencia del canal web (que usa
// la cookie de sesión), este se autentica con una API key (WHATSAPP_API_KEY) y
// devuelve UNA respuesta completa en texto plano (WhatsApp no hace streaming).
// El gateway de WhatsApp (Twilio, Cloud API, n8n, whatsapp-web.js…) llama aquí
// con el teléfono y el mensaje del cliente, y reenvía la respuesta al chat.

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_MENSAJE = 2000;
const LIMITE_POR_MINUTO = 20;

// Memoria de conversación por número de teléfono (para que el chat tenga
// contexto): 30 min de inactividad y 12 mensajes (memoria-conversacion.ts).
const memoria = crearMemoriaConversacion();
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

// Las fotos se entregan por el proxy sellado /api/whatsapp/foto con marca
// única en la ruta (fotos-respuesta.ts, compartido con el mostrador).

function excedeLimite(telefono: string): boolean {
  const ahora = Date.now();
  const ventana = (ventanas.get(telefono) ?? []).filter((t) => ahora - t < 60_000);
  if (ventana.length >= LIMITE_POR_MINUTO) return true;
  ventana.push(ahora);
  ventanas.set(telefono, ventana);
  return false;
}

/** La liga al PDF del pedido que este cliente envió en el turno, o null. */
async function enlacePdfDelTurno(
  actor: ActorVendedor,
  inicioTurno: string,
  base: string
): Promise<EnlacePedido | null> {
  if (!puedePedir(actor) || actor.tipo !== "cliente") return null;
  try {
    const [ultimo] = await ultimosPedidosDeTelefono(actor.telefono, 1);
    const enlace = enlacePdfSiSeEnvio(ultimo, inicioTurno, base);
    if (enlace) console.log(`[pedido-whatsapp] ${actor.telefono} envió ${enlace.folio}; va la liga al PDF`);
    return enlace;
  } catch (error) {
    console.error("No se pudo armar la liga al PDF del pedido:", error);
    return null;
  }
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

  if (cuerpo.reiniciar) memoria.olvidar(telefono);
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

    // ¿Quién escribe? El padrón es la tabla clientes_descuento de la base de
    // conversaciones (lo que el personal captura en "Clientes con descuento"):
    // si el número está ahí se le cotiza con SU descuento; si no, a precio de
    // mostrador. El catálogo de clientes de bdav NO se consulta para esto. La
    // llave es el teléfono nacional de 10 dígitos, con la MISMA normalización
    // que usa el alta del panel: lo que WhatsApp manda como 5218112345678 se
    // busca como 8112345678. El chat de la página entra con una sesión sintética
    // 77…, donde no hay teléfono real que buscar. Un fallo aquí no puede dejar
    // al cliente sin respuesta: se cae a mostrador.
    const telefonoPadron = ES_SESION_WEB.test(telefono) ? "" : normalizarTelefono(telefono);
    const cliente = telefonoPadron
      ? await obtenerClienteDescuentoPorTelefono(telefonoPadron).catch((error) => {
          console.error("No se pudo identificar al cliente por su teléfono:", error);
          return null;
        })
      : null;
    if (cliente) {
      console.log(
        `[cliente-whatsapp] ${telefono} = ${cliente.cliente} (descuento ${cliente.descuento}%)`
      );
    }

    // Quién habla, para las herramientas de pedido: el cliente del padrón (que
    // solo puede pedir si el padrón lo autoriza) o un anónimo, que nunca puede.
    // Las sesiones sintéticas 77… del chat de la página siguen siendo anónimas.
    const actor: ActorVendedor = cliente
      ? {
          tipo: "cliente",
          idCliente: cliente.id,
          nombre: cliente.cliente,
          telefono: telefonoPadron,
          descuento: cliente.descuento,
          permitirPedido: cliente.permitirPedido,
        }
      : { tipo: "anonimo" };

    // Contexto que el modelo no ve entre turnos (la memoria guarda solo texto,
    // no lo que devolvieron las herramientas): el pedido en captura del cliente
    // y si este número puede pedir. Sin esto, al "sí" del cliente el modelo
    // volvía a agregar las piezas en vez de confirmar (3-sep-2026). El chat de
    // la página (sesión 77…) no lleva notas: ahí no hay pedidos.
    const esSesionWeb = ES_SESION_WEB.test(telefono);
    const borrador =
      !esSesionWeb && puedePedir(actor) && actor.tipo === "cliente"
        ? await obtenerBorrador({ tipo: "cliente", telefono: actor.telefono }).catch((error) => {
            console.error("No se pudo leer el pedido en captura del cliente:", error);
            return null;
          })
        : null;
    const nota = esSesionWeb ? null : notaContextoPedido(actor, borrador);
    const inicioTurno = ahoraMonterrey().momento;

    const respuesta = await correrVendedor({
      pregunta: preguntaConNota(nota, mensaje),
      historial: memoria.historialDe(telefono),
      modelo,
      descuentoCliente: cliente?.descuento ?? null,
      actor,
      alCodigos: (codigos) => codigos.forEach((c) => codigosConsultados.add(c)),
      alFotosUsadas: (fotos) =>
        fotos.forEach((f) => fotosUsadas.set(f.codigo.toUpperCase(), f.url)),
    });
    // El agente marca los productos sugeridos con [[FOTOS: cod1, cod2]] al final;
    // se extraen los códigos y se quita esa línea técnica del texto visible.
    const { texto: limpio, codigosMarcados } = separarMarcadorFotos(respuesta);
    const respuestaLimpia = limpio || "Disculpa, no te entendí. ¿Qué parte buscas?";
    // Si en este turno se envió el pedido, la liga a su PDF va en el mismo
    // mensaje (solo clientes del padrón con permiso; la liga lleva firma). Va
    // sobre PUBLIC_BASE_URL, nunca sobre el Host de la petición: sin ella no
    // hay liga.
    const enlace = await enlacePdfDelTurno(actor, inicioTurno, baseUrlConfigurada());
    const texto = enlace ? textoConEnlacePdf(respuestaLimpia, enlace) : respuestaLimpia;
    memoria.guardarTurno(telefono, mensaje, texto);

    // Solo se aceptan códigos REALES (que el catálogo devolvió) y con foto, ya
    // con la URL del proxy sellado (fotos-respuesta.ts).
    const fotos = await fotosDeRespuesta({
      codigosMarcados,
      codigosConsultados,
      fotosUsadas,
      base: baseUrlPublica(request),
    });

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
