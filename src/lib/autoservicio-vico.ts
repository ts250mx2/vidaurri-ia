import { NextResponse } from "next/server";
import { credencialParaRuta } from "@/lib/agente-modelo";
import {
  actorCapturaDe,
  actorVicoDe,
  areaDe,
  canalDe,
  claveConversacionDe,
  claveCupoDe,
  descuentoDe,
  validarCuerpoVico,
  type Ambito,
} from "@/lib/autoservicio";
import { guardarIntercambio, type CanalConversacion } from "@/lib/db-conversaciones";
import { obtenerBorrador } from "@/lib/db-pedidos";
import { fotosDeRespuesta, separarMarcadorFotos } from "@/lib/fotos-respuesta";
import { ERROR_CUPO_VICO, LIMITE_VICO_KIOSCO, crearCupo, pedidoParaKiosco, productoParaKiosco } from "@/lib/kiosco-api";
import { crearMemoriaConversacion } from "@/lib/memoria-conversacion";
import { productosMencionados } from "@/lib/productos-mencionados";
import { baseUrlPublica } from "@/lib/url-publica";
import { correrVendedor } from "@/lib/vendedor";

// Vico en el autoservicio: "¿No sabes cómo se llama la pieza? Pregúntale a
// Vico". Un solo manejador para el kiosco (actor 'kiosco': solo las tres
// herramientas de armar el pedido, mandarlo es el botón de la pantalla) y
// para el área de clientes (el actor 'cliente' que ya existe para WhatsApp,
// en canal web, con su descuento del padrón).
//
// La memoria de conversación vive en el proceso y es de ESTE manejador: por
// aparato en el kiosco, por cliente (y sesión de la página) en el área. Nunca
// la de WhatsApp, que es de otro canal. La respuesta va recortada igual que
// el resto del autoservicio: productos sin existencia exacta, pedido sin id,
// bitácora ni datos del POS.

const RESPUESTA_VACIA = "Disculpa, no te entendí. ¿Qué pieza buscas?";

type ResolverAmbito = (request: Request) => Promise<{ ok: true; ambito: Ambito } | { ok: false; respuesta: NextResponse }>;

/** Con qué teléfono y canal se firma la bitácora: la clave del aparato en el
 *  kiosco; el celular del cliente, en canal web, en el área. */
function bitacoraDe(ambito: Ambito): { telefono: string; canal: CanalConversacion } {
  if (ambito.tipo === "kiosco") return { telefono: `k:${ambito.sesion.kiosco}`, canal: "kiosco" };
  return { telefono: ambito.cliente.telefono, canal: "web" };
}

export function crearManejadorVico(resolver: ResolverAmbito): (request: Request) => Promise<NextResponse> {
  const memoria = crearMemoriaConversacion();
  const cupo = crearCupo(LIMITE_VICO_KIOSCO);

  return async function vico(request: Request): Promise<NextResponse> {
    const guardia = await resolver(request);
    if (!guardia.ok) return guardia.respuesta;
    const { ambito } = guardia;

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
    const validacion = validarCuerpoVico(cuerpo);
    if (!validacion.ok) return NextResponse.json({ ok: false, error: validacion.error }, { status: 400 });
    const { mensaje, reiniciar, sesion } = validacion.datos;

    const clave = claveConversacionDe(ambito, sesion);
    if (reiniciar) memoria.olvidar(clave);
    if (!cupo.intentar(claveCupoDe(ambito))) {
      return NextResponse.json({ ok: false, error: ERROR_CUPO_VICO }, { status: 429 });
    }

    const actor = actorVicoDe(ambito);
    const actorCaptura = actorCapturaDe(ambito);
    const area = areaDe(ambito);

    try {
      // Códigos que el agente consultó (para adjuntar las fotos que mencione),
      // fotos públicas de las usadas y los resultados crudos del turno, de donde
      // salen los renglones con botón "Agregar" de la pantalla.
      const codigosConsultados = new Set<string>();
      const fotosUsadas = new Map<string, string>();
      const resultadosPorHerramienta: Array<{ herramienta: string; resultados: unknown[] }> = [];

      // Sin la nota de contexto de WhatsApp: en el autoservicio (kiosco y
      // área) enviar es el botón de la pantalla, no hay "sí" que confirmar.
      const respuesta = await correrVendedor({
        pregunta: mensaje,
        historial: memoria.historialDe(clave),
        credencial,
        // Sin imágenes inline: las fotos van aparte, como en el mostrador.
        canal: "whatsapp",
        // Precio de mostrador, o el descuento del padrón del cliente.
        descuentoCliente: descuentoDe(ambito),
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
      const borrador = await obtenerBorrador(actorCaptura).catch((error) => {
        console.error(`[${area}-vico] no se pudo leer el pedido tras el turno:`, error);
        return null;
      });

      // Bitácora en BDVidaurriConversaciones (fire-and-forget: si falla, la
      // respuesta al cliente sale de todas formas).
      const bitacora = bitacoraDe(ambito);
      void guardarIntercambio({
        telefono: bitacora.telefono,
        canal: bitacora.canal,
        mensajeCliente: mensaje,
        respuestaVendedor: texto,
        fotos: fotos.map((f) => f.url),
      }).catch((error) => {
        console.error(`[${area}-vico] no se pudo guardar la conversación en la bitácora:`, error);
      });

      return NextResponse.json({
        ok: true,
        respuesta: texto,
        fotos,
        productos: productos.map(productoParaKiosco),
        pedido: pedidoParaKiosco(borrador),
      });
    } catch (error) {
      console.error(`Error en Vendedor IA (${area}, canal ${canalDe(ambito)}):`, error);
      return NextResponse.json({ ok: false, error: "No fue posible responder en este momento" }, { status: 502 });
    }
  };
}
