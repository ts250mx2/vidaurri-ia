// Lo que el webservice de WhatsApp pone alrededor de cada turno del Vendedor
// IA cuando hay pedidos de por medio. Lógica pura (sin base ni modelo): la
// ruta junta los datos y estas funciones deciden el texto.

import { urlPdfPedido } from "./pedido-enlace";
import type { PedidoDetalle, PedidoResumen } from "./pedidos";
import type { ActorVendedor } from "./vendedor-pedidos";

const NOTA = "Nota interna del sistema (no la cites ni la menciones):";

/**
 * Contexto que el modelo no ve entre turnos, porque la memoria de la
 * conversación guarda solo texto y no lo que devolvieron las herramientas:
 * que el cliente YA tiene un pedido en captura (para que a su "sí" lo
 * confirme en vez de volver a agregar las piezas, que fue lo que pasó el
 * 3-sep-2026) y si este número puede pedir o no, y por qué.
 */
export function notaContextoPedido(actor: ActorVendedor, borrador: PedidoDetalle | null): string | null {
  if (actor.tipo === "anonimo") {
    return `${NOTA} este número NO está en el padrón de clientes. Si pide levantar un pedido, dile en una línea que por WhatsApp solo se levantan pedidos desde un número registrado en el padrón y con permiso de pedidos, y que lo solicite en el mostrador; tú aquí solo cotizas.`;
  }
  if (actor.tipo !== "cliente") return null;
  if (!actor.permitirPedido) {
    return `${NOTA} el número está registrado a nombre de ${actor.nombre}, pero NO tiene habilitado levantar pedidos por WhatsApp. Si pide un pedido, díselo en una línea y que pida en el mostrador que le activen el permiso; tú aquí solo cotizas.`;
  }
  if (!borrador || borrador.partidas.length === 0) return null;
  const piezas = borrador.partidas.reduce((suma, p) => suma + p.cantidad, 0);
  return `${NOTA} ${actor.nombre} YA tiene un pedido en captura con ${piezas} pieza(s) en ${borrador.partidas.length} renglón(es), listo para confirmar. Si responde que sí, que lo confirme o que está bien, llama confirmar_pedido de inmediato; si quiere revisarlo, ver_pedido. NO llames agregar_al_pedido con piezas que ya están en el pedido: eso suma cantidades y las duplica.`;
}

/** El mensaje que ve el modelo: la nota, si la hay, y luego lo que escribió el cliente. */
export function preguntaConNota(nota: string | null, mensaje: string): string {
  return nota ? `${nota}\n\nMensaje del cliente: ${mensaje}` : mensaje;
}

export interface EnlacePedido {
  folio: string;
  url: string;
}

/**
 * Si el último pedido del cliente se envió en este turno (enviadoEn en o
 * después del inicio del turno, ambos en hora de Monterrey), la liga a su PDF.
 */
export function enlacePdfSiSeEnvio(
  ultimo: PedidoResumen | undefined,
  inicioTurno: string,
  base: string
): EnlacePedido | null {
  if (!ultimo?.folio || !ultimo.enviadoEn || ultimo.enviadoEn < inicioTurno) return null;
  const url = urlPdfPedido(base, ultimo.id);
  return url ? { folio: ultimo.folio, url } : null;
}

export function textoConEnlacePdf(texto: string, enlace: EnlacePedido): string {
  return `${texto.trimEnd()}\n\n📄 Tu pedido ${enlace.folio} en PDF: ${enlace.url}`;
}
