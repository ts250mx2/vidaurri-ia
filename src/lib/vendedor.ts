import type Anthropic from "@anthropic-ai/sdk";
import { consultaBdav } from "@/lib/db";
import { consultaUsadas } from "@/lib/db-usadas";
import { precioAldo } from "@/lib/aldo";
import { correrTurnoAgente, type UsoHerramienta } from "@/lib/agente-modelo";
import { condicionesPorPalabra, expresionRelevancia } from "@/lib/busqueda";
import { observacionOrigen } from "@/lib/origen-pieza";
import {
  catalogoVacio,
  cifrasInventadas,
  registrarRespuestaPrevia,
  registrarResultado,
  type CifrasInventadas,
} from "@/lib/vendedor-cifras";
import {
  ejecutarHerramientaPedido,
  esHerramientaPedido,
  herramientasPedidoPara,
  puedePedir,
  type ActorVendedor,
} from "@/lib/vendedor-pedidos";

// Núcleo del agente "Vendedor IA": prompt, herramientas de catálogo y el loop
// del agente. Lo comparten el endpoint web (streaming), el de WhatsApp (una
// sola respuesta) y el del mostrador, para no duplicar el comportamiento. Las
// herramientas de PEDIDO viven en vendedor-pedidos.ts y solo entran cuando el
// actor puede pedir.

const MAX_ITERACIONES = 6;
const MAX_TOKENS = 1500; // respuestas cortas estilo chat de WhatsApp
const MAX_RESULTADOS = 15;
// Disponibilidad con el proveedor (Aldo): solo para los primeros resultados,
// porque cada consulta es scraping de su sitio (con caché y semáforo en aldo.ts).
const MAX_CONSULTAS_ALDO = 5;
// Llaves distintas de cruce con la Bodega Usado por búsqueda (una sola consulta).
const MAX_LLAVES_USADO = 8;

/** Estilo de respuesta según el canal de conversación. */
export const ETIQUETA_HERRAMIENTA: Record<string, string> = {
  buscar_productos: "Buscando productos",
  buscar_piezas_usadas: "Buscando piezas usadas",
  listar_marcas: "Revisando marcas",
  listar_tipos_parte: "Revisando tipos de pieza",
  seleccionar_cliente: "Buscando al cliente",
  agregar_al_pedido: "Agregando al pedido",
  ver_pedido: "Revisando el pedido",
  quitar_del_pedido: "Quitando del pedido",
  cambiar_sucursal: "Cambiando la sucursal",
  confirmar_pedido: "Enviando el pedido",
  cancelar_pedido: "Cancelando el pedido",
};

export type CanalVendedor = "web" | "whatsapp";

// Fotos públicas de las piezas usadas (mismo origen que el proxy /api/usadas/foto).
// El archivo es el nombre_imagen que registra piezas_imagenes.
const BASE_FOTOS_USADAS = "https://sistema.apvidaurri.com/imagenes_piezas";

export function urlFotoUsadaPublica(nombreImagen: string): string {
  return `${BASE_FOTOS_USADAS}/${encodeURIComponent(nombreImagen)}`;
}

/**
 * Sección PEDIDOS del prompt: solo existe cuando el actor puede pedir. Le dice
 * al modelo qué es un pedido (NO un apartado), de dónde salen los códigos que
 * agrega, que confirme solo con un sí explícito, y a quién tiene enfrente: al
 * vendedor del mostrador (con el cliente que atiende y su descuento) o al
 * cliente del padrón que pide para sí mismo.
 */
function seccionPedidos(actor: ActorVendedor | undefined): string {
  if (!puedePedir(actor)) return "";
  const esVendedor = actor.tipo === "vendedor";
  const quien = esVendedor ? "el vendedor" : "el cliente";
  let contexto: string;
  if (!esVendedor) {
    contexto = `- El cliente es ${actor.nombre}, del padrón, con ${actor.descuento}% de descuento: los precios que devuelven las herramientas YA lo llevan. Solo puede pedir para sí mismo.`;
  } else if (actor.idCliente === null) {
    contexto = `- Hablas con ${actor.nombre}, vendedor del mostrador: háblale de tú y ayúdale a capturar rápido. Está atendiendo a PÚBLICO GENERAL (sin descuento de padrón): los precios que devuelven las herramientas son los de mostrador.`;
  } else {
    contexto = `- Hablas con ${actor.nombre}, vendedor del mostrador: háblale de tú y ayúdale a capturar rápido. Está atendiendo a ${actor.clienteNombre} con ${actor.descuento}% de descuento del padrón: los precios que devuelven las herramientas YA lo llevan, no lo vuelvas a aplicar ni lo menciones como si faltara.`;
  }
  const cambioCliente = esVendedor
    ? `\n- Para atender a otro cliente usa seleccionar_cliente: devuelve candidatos del padrón, pero la selección la fija el vendedor EN PANTALLA. Pídele que lo elija ahí y no cotices ni pidas como si ya hubiera cambiado.`
    : "";
  return `PEDIDOS (puedes levantar pedidos):
${contexto}${cambioCliente}
- Puedes levantar un PEDIDO para recoger en sucursal: Matriz o Sucursal Fierro (por defecto Matriz; cámbiala con cambiar_sucursal si ${quien} lo pide). Queda SUJETO A CONFIRMACIÓN de existencia por el mostrador: NUNCA lo llames apartado ni digas que la pieza está guardada, separada o reservada hasta que el mostrador lo marque Listo.
- Agrega piezas con agregar_al_pedido usando el código EXACTO que devolvió buscar_productos (o el idPieza de buscar_piezas_usadas para una usada). Si ${quien} pide agregar una pieza que no has buscado en esta conversación, búscala primero. Nunca agregues nada que ${quien} no haya pedido.
- Antes de confirmar muestra el resumen con ver_pedido (piezas, cantidades, sucursal y total con IVA) y pregunta si está bien. Llama confirmar_pedido SOLO cuando ${quien} diga que sí de forma explícita ("confírmalo", "sí, mándalo"); nunca por tu cuenta.
- Al confirmar, da el folio (por ejemplo P-000131) EXACTAMENTE como lo devolvió la herramienta y recuerda que el mostrador confirma existencia y avisa cuando esté listo para recoger.
- Los precios, importes y totales de las herramientas de pedido se citan tal cual (ya son con IVA y con el descuento que corresponde). Escríbelos entre asteriscos como cualquier precio.
- quitar_del_pedido quita una pieza; cancelar_pedido cancela el pedido en captura. Si una herramienta devuelve error, dilo en una línea y pregunta cómo seguir; no lo disfraces de éxito.`;
}

export function promptSistema(hoy: string, canal: CanalVendedor = "whatsapp", actor?: ActorVendedor): string {
  // Sin permiso de pedidos (anónimo, cliente fuera del padrón o sin
  // autorización) el prompt es el de siempre salvo por los segmentos de abajo,
  // que solo cambian cuando puedePedir. Hay un test que lo comprueba por hash.
  const conPedidos = puedePedir(actor);
  const apertura =
    conPedidos && actor.tipo === "vendedor"
      ? `Eres Vico, el asistente de ventas de AUTO PARTES VIDAURRI, y en este chat apoyas a ${actor.nombre} (vendedor del mostrador) mientras atiende a un cliente en persona.`
      : "Eres el vendedor de AUTO PARTES VIDAURRI atendiendo a un cliente por WhatsApp.";
  // Sin permiso de pedidos NO hay dónde guardar nada: el modelo no tiene
  // herramienta de pedido ni de "tomar datos". Dejarle "ofrecer tomar sus
  // datos" acababa en un "quedó registrado tu pedido" que nadie ve (pasó en la
  // página pública). La regla honesta: por este chat no se levantan pedidos, y
  // el camino que sí existe es WhatsApp con el número registrado o el mostrador.
  const sinOpciones = conPedidos
    ? "- Si no hay entrega inmediata, ni sobre pedido, ni usado, dilo claro y ofrece tomar sus datos para conseguirla; esa pieza NO se agrega al pedido."
    : "- Si no hay entrega inmediata, ni sobre pedido, ni usado, dilo claro y sugiere que lo consulte con el mostrador (por WhatsApp o por teléfono): tú no puedes tomar datos ni dejar encargos.";
  const reglaApartado = conPedidos
    ? `- NUNCA digas "apartar", "reservar" ni "separar": lo que levantas es un PEDIDO sujeto a
  confirmación del mostrador (ver PEDIDOS). Cierra preguntando el dato que te falte (lado,
  año, versión) o si quiere agregar la pieza al pedido.`
    : `- NUNCA ofrezcas apartar, reservar ni separar la pieza ("¿te la aparto?", "te la separo",
  "¿te la reservo?"). No manejamos apartados por chat. Cierra preguntando el dato que te
  falte (lado, año, versión) o si quiere que le confirmes algo más.
- Por este chat NO puedes levantar pedidos ni guardar datos: no tienes ninguna herramienta
  para eso. Si el cliente quiere pedir, dile la verdad en una línea: que escriba al WhatsApp
  del mostrador desde su número registrado (ahí, si tiene permiso de pedidos, se le levanta el
  pedido) o que llame al mostrador; si ya está escribiendo por WhatsApp, que el mostrador le
  active el permiso de pedidos o lo atienda un vendedor. PROHIBIDO pedirle nombre o teléfono
  "para levantar el pedido" y PROHIBIDO decir que un pedido quedó registrado, anotado,
  levantado o confirmado, o que alguien lo va a contactar: nada de eso ocurre.`;
  const pedidos = conPedidos ? `\n\n${seccionPedidos(actor)}` : "";
  // En el panel web se pueden mostrar imágenes; en WhatsApp no (llegaría como
  // texto crudo), así que solo se pide la foto para el canal web.
  const instruccionFoto =
    canal === "web"
      ? `\n- OBLIGATORIO: cada vez que menciones un producto concreto (con su código), DEBAJO de esa línea agrega SIEMPRE su foto en una línea aparte:
  * Producto NUEVO (de buscar_productos): ![](/api/articulos/foto?codigo=CODIGO) — reemplaza CODIGO por el código EXACTO que te dio la herramienta. Ejemplo:
  *Cofre Versa 15-19* (CNVE15) — $1,709.84 c/IVA 📦
  ![](/api/articulos/foto?codigo=CNVE15)
  * Pieza USADA (de buscar_piezas_usadas): usa el campo foto que trae cada resultado (una ruta que empieza con /api/usadas/foto). Pon exactamente: ![](valor del campo foto). Si foto viene null, omite la imagen de esa pieza.
  Nunca omitas la foto de un producto que sugieres y NUNCA inventes rutas de foto.
- Si el cliente pide fotos (o vuelves a mencionar productos de turnos anteriores), NO respondas de memoria: el campo foto SOLO viene en resultados de herramientas de ESTE turno, así que DEBES volver a buscar esos productos con la herramienta y entonces incluir sus ![](...). PROHIBIDO decir "aquí las fotos" sin incluir las imágenes.`
      : `\n- AL FINAL de tu respuesta agrega SIEMPRE una última línea técnica con los códigos EXACTOS de los productos que sugeriste (nuevos o usados), con este formato: [[FOTOS: CODIGO1, CODIGO2]] (máximo 3, usa los códigos EXACTOS que te dio la herramienta). Esa línea es SOLO para el sistema (sirve para enviar las fotos); el cliente no la verá, así que no la comentes ni la expliques. Si no sugeriste ningún producto, no pongas la línea.
- Si el cliente pide fotos (o vuelves a mencionar productos de turnos anteriores), DEBES volver a buscarlos con la herramienta en ESTE turno: las fotos solo se pueden enviar de productos consultados en este turno.`;
  return `${apertura} Vidaurri vende autopartes de colisión (cofres, defensas, parrillas, faros, tolvas, guías, molduras, etc.) por marca, modelo y rango de años. Hoy es ${hoy}.

Consultas el catálogo real con tus herramientas:
- buscar_productos: por descripción (incluye modelo y años, p.ej. "COFRE VERSA 15-19"), acotando por marca, tipo de parte y año. Devuelve por producto: precio con IVA, entregaInmediata (piezas en tienda), sobrePedido (disponibilidad para conseguirla sobre pedido) y usado (piezas usadas equivalentes en la Bodega Usado).
- buscar_piezas_usadas: detalle del inventario de la BODEGA USADO (piezas usadas: puertas, faros, calaveras, espejos, elevadores, computadoras...). Úsala cuando el cliente quiera ver las opciones de usado.
- listar_marcas / listar_tipos_parte: qué hay en catálogo.

LÓGICA DE ENTREGA Y PRECIOS (obligatoria, síguela SIEMPRE):
- *Entrega inmediata*: cuando entregaInmediata > 0 (existencia en tienda). Precio: precioConIva.
- *Sobre pedido*: cuando NO hay entrega inmediata pero sobrePedido > 0 (o "Mas de N"). Di "la tengo sobre pedido" (SIN prometer días de entrega ni plazos). El precio es EL MISMO precioConIva de la pieza nueva; NUNCA menciones al proveedor ni des otro precio por esta vía.
- *Observación de origen*: si el resultado trae observacion (por ejemplo "Taiwán"), DILA SIEMPRE junto a esa pieza, en la misma línea o la siguiente. Es de dónde viene la refacción y el cliente tiene derecho a saberlo antes de comprar; no la escondas ni la suavices. Si observacion viene null, no comentes nada del origen.
- *Usado*: cuando usado trae piezas > 0 hay equivalentes usados en nuestra Bodega Usado. Ofrécelo SOLO si usado.desdeConIva es MENOR que el precioConIva de la nueva (el usado se ofrece como alternativa económica: si sale igual o más caro, NO lo menciones, recomienda la nueva y ya). Cuando sí lo ofrezcas, di "también la tengo usada desde $X" con usado.desdeConIva y ACLARA siempre que es pieza USADA. El precio del usado es el del usado (con IVA), no el de la nueva. Detalles con buscar_piezas_usadas.
- Si una opción NO existe (sobrePedido en 0 o null, usado null o con 0 piezas), simplemente NO la menciones; no digas "no hay usado" ni "no hay con proveedor".
${sinOpciones}

ESTILO WHATSAPP (muy importante):
- Responde CORTO y natural, como un chat de WhatsApp. Nada de párrafos largos ni tablas.
- Usa el formato de WhatsApp: *negritas* con un solo asterisco (NO markdown de tablas, NO títulos con #).
- Muestra máximo 2 o 3 productos, los más relevantes. Cada uno en 1-2 líneas: nombre en negritas con su código SIEMPRE entre paréntesis — *Cofre Aveo 18-23* (CCAE18) —, *precio con IVA* y la forma de entrega (inmediata / sobre pedido / usado). El código nunca se omite: el cliente lo usa para pedir en mostrador y la página web lo usa para enlazar la pieza.
- Puedes usar pocos emojis para dar calidez (👍 🔧 📦 💵), sin exagerar.
- Si falta un dato para acertar (modelo, año, si es sedán/hatchback, lado izquierdo/derecho), pregúntalo en una línea.
${reglaApartado}
- SIEMPRE cotiza con precioConIva, que es el precio de mostrador (ya con descuento) más IVA.
  Escríbelo SIEMPRE entre asteriscos, *$1,204.08*, para marcar que es precio con descuento.
  NUNCA presentes precioSinIva como si fuera el precio: solo dilo si el cliente pide
  expresamente el precio sin IVA, aclarándolo.
- NUNCA escribas de memoria un código ni un precio: cópialos carácter por carácter del
  resultado de la búsqueda. Si el dato no está ahí, no lo inventes — dilo o pregúntalo.
- ANTES de decir que no hay algo, vuelve a buscar con menos palabras (solo la pieza y el
  modelo, sin año ni lado) y con otra forma de nombrarla. Nunca contestes que no tienes
  una pieza después de una sola búsqueda que salió vacía.
- Si aun así no encuentras nada, pide más datos amablemente.${instruccionFoto}${pedidos}

Reglas:
- NUNCA pienses en voz alta ni te corrijas a media frase ("espera...", "déjame ver...", "ah no, mejor..."). Decide ANTES de escribir y manda solo la respuesta final y limpia.
- NUNCA inventes productos, códigos ni precios: solo lo que devuelvan las herramientas.
- Montos en pesos: $#,##0.00.
- Si preguntan algo ajeno a comprar autopartes de Vidaurri, contesta amable que solo ayudas con eso.`;
}

export const HERRAMIENTAS: Anthropic.Tool[] = [
  {
    name: "buscar_productos",
    description:
      "Busca artículos en el catálogo de Vidaurri. La descripción incluye normalmente el modelo y el rango de años. Devuelve hasta 15 productos con precio (con y sin IVA), entregaInmediata (existencia en tienda), sobrePedido (disponibilidad para conseguir la pieza sobre pedido, solo en los primeros resultados) y usado (resumen de piezas usadas equivalentes en la Bodega Usado).",
    input_schema: {
      type: "object" as const,
      properties: {
        descripcion: {
          type: "string",
          description:
            "Palabras a buscar en la descripción o el código, p.ej. 'cofre versa'. Todas las palabras deben aparecer.",
        },
        marca: {
          type: "string",
          description:
            "Marca (fabricante) del auto, opcional. Ej. NISSAN, DODGE. El MODELO (Journey, Versa...) NO va aquí: ponlo en descripcion.",
        },
        tipoParte: {
          type: "string",
          description: "Tipo de pieza, opcional. Ej. COFRES, DEFENSAS DELANTERAS",
        },
        anio: {
          type: "number",
          description: "Año del vehículo para filtrar por aplicación, opcional. Ej. 2016",
        },
        soloConExistencia: {
          type: "boolean",
          description: "Si es true, solo devuelve artículos con existencia mayor a cero.",
        },
      },
      required: ["descripcion"],
    },
  },
  {
    name: "listar_marcas",
    description: "Lista las marcas de auto (líneas) disponibles en el catálogo.",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "listar_tipos_parte",
    description: "Lista los tipos de pieza (partes) disponibles en el catálogo.",
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "buscar_piezas_usadas",
    description:
      "Busca piezas USADAS con existencia en el inventario de la Bodega Usado (sucursal de piezas usadas, base aparte del catálogo de nuevas). Devuelve hasta 15 piezas con precio (sin y con IVA), años de aplicación, ubicación e idPieza (la referencia para agregarla a un pedido).",
    input_schema: {
      type: "object" as const,
      properties: {
        descripcion: {
          type: "string",
          description:
            "Palabras a buscar: tipo de pieza y MODELO del auto, p.ej. 'puerta journey' o 'calavera sentra'. Todas las palabras deben aparecer (cruzan descripción, código, tipo de parte, marca y modelo).",
        },
        marca: {
          type: "string",
          description:
            "Marca (fabricante) del auto, opcional. Ej. CHEVROLET, DODGE. El MODELO (Journey, Versa...) NO va aquí: ponlo en descripcion.",
        },
        anio: {
          type: "number",
          description: "Año del vehículo para filtrar por aplicación, opcional. Ej. 2015",
        },
      },
      required: ["descripcion"],
    },
  },
];

/**
 * Herramientas de ESTA llamada: las del catálogo más las de pedido cuando el
 * actor puede pedir. El cache_control (cachea el prefijo tools+system entre
 * rondas) va en la ÚLTIMA del arreglo resultante, por eso no vive en el
 * literal: con las tools de pedido la última ya no es buscar_piezas_usadas.
 */
export function herramientasPara(actor?: ActorVendedor): Anthropic.Tool[] {
  const todas = [...HERRAMIENTAS, ...herramientasPedidoPara(actor)];
  const ultima = todas[todas.length - 1];
  return [...todas.slice(0, -1), { ...ultima, cache_control: { type: "ephemeral" } }];
}

interface FilaProducto {
  codigo: string;
  descripcion: string;
  marca: string;
  tipoParte: string;
  aini: number | null;
  afin: number | null;
  precioSinIva: number;
  precioConIva: number;
  existencia: number;
  localizacion: string | null;
}

/** Resumen de piezas usadas equivalentes para un producto (Bodega Usado). */
interface ResumenUsado {
  piezas: number;
  /** Precio "desde" del usado CON IVA; null si ninguna pieza tiene precio. */
  desdeConIva: number | null;
}

/** Raíz del tipo de parte para cruzar catálogos (bdav usa plural "FAROS", la
 *  Bodega singular "FARO"). Mismo criterio que /api/articulos/usadas. */
function raizParte(parte: string): string {
  const primera = parte.trim().toUpperCase().split(/\s+/)[0] ?? "";
  return primera.replace(/S$/, "");
}

/** Llave de cruce con la Bodega por producto (marca + raíz + rango de años). */
// La llave es el código del artículo, no parte+marca+años: desde que el cruce
// exige que coincida el MODELO, dos artículos que comparten tipo y marca
// (CALAVERA AVEO y CALAVERA MALIBU, ambas CHEVROLET) ya no tienen el mismo
// resultado y no pueden compartir consulta.
function llaveUsado(f: FilaProducto): string | null {
  const raiz = raizParte(f.tipoParte);
  const marca = f.marca.trim();
  if (!raiz || !marca) return null;
  return f.codigo;
}

/** Consulta en UNA pasada (UNION ALL por llave) cuántas piezas usadas
 *  equivalentes hay y su precio "desde". Si la Bodega no responde, devuelve un
 *  mapa vacío: la venta de nuevo no debe bloquearse por la base remota. */
async function resumenUsadoPorLlave(
  filas: FilaProducto[]
): Promise<Map<string, ResumenUsado>> {
  const llaves = new Map<string, FilaProducto>();
  for (const f of filas) {
    const llave = llaveUsado(f);
    if (llave && !llaves.has(llave)) llaves.set(llave, f);
    if (llaves.size >= MAX_LLAVES_USADO) break;
  }
  if (llaves.size === 0) return new Map();

  const bloques: string[] = [];
  const params: unknown[] = [];
  for (const [llave, f] of llaves) {
    const condiciones = [
      "p.existencia > 0",
      // Sin precio no se puede ofrecer como alternativa económica.
      "p.precio > 0",
      "pa.parte LIKE ?",
      // La marca puede venir compuesta en la Bodega ("DODGE / CHRYSLER").
      "(ma.marca LIKE ? OR ? LIKE CONCAT('%', ma.marca, '%'))",
      // Y el MODELO tiene que aparecer en la descripción del artículo. Sin esto
      // una CALAVERA AVEO contaba como equivalentes las 526 calaveras Chevrolet
      // de Traverse, Silverado y Malibu, y el agente ofrecía una usada "desde
      // $928" que después no encontraba. Se compara palabra completa (con la
      // descripción entre espacios) porque hay modelos de una o dos letras
      // ("2", "3", "G3") que como subcadena casarían con cualquier cosa.
      "CONCAT(' ', ?, ' ') LIKE CONCAT('% ', mo.modelo, ' %')",
    ];
    params.push(
      llave,
      `${raizParte(f.tipoParte)}%`,
      `%${f.marca.trim()}%`,
      f.marca.trim(),
      f.descripcion
    );
    const aini = Number(f.aini);
    const afin = Number(f.afin);
    if (aini > 1900 && afin > 1900) {
      // Piezas sin rango capturado (0/NULL) cuentan como comodín.
      condiciones.push(
        "(IFNULL(p.anio_inicio, 0) = 0 OR p.anio_inicio <= ?)",
        "(IFNULL(p.anio_fin, 0) = 0 OR p.anio_fin >= ?)"
      );
      params.push(afin, aini);
    }
    bloques.push(
      `SELECT ? AS clave, COUNT(*) AS piezas, MIN(NULLIF(p.precio, 0)) AS desde
         FROM piezas p
         JOIN partes pa ON pa.id_parte = p.id_parte
         LEFT JOIN modelos mo ON mo.id_modelo = p.id_modelo
         LEFT JOIN marcas ma ON ma.id_marca = mo.id_marca
        WHERE ${condiciones.join(" AND ")}`
    );
  }

  try {
    const resultados = await consultaUsadas<{ clave: string; piezas: number; desde: number | null }>(
      bloques.join("\nUNION ALL\n"),
      params
    );
    const mapa = new Map<string, ResumenUsado>();
    for (const r of resultados) {
      mapa.set(r.clave, {
        piezas: r.piezas,
        desdeConIva: r.desde ? Math.round(r.desde * 1.16 * 100) / 100 : null,
      });
    }
    return mapa;
  } catch (error) {
    console.error("Bodega Usado sin respuesta al cruzar productos:", error);
    return new Map();
  }
}

// Campos donde puede caer lo que escribe el cliente. Antes solo se miraba
// descripcion/codigo, asi que "faro nissan" fallaba cuando la marca vive en
// `lineas` y el tipo de pieza en `partes`.
const CAMPOS_ARTICULO = ["a.descripcion", "a.codigo", "p.parte", "l.linea"];
const CAMPOS_USADA = ["p.descripcion", "p.codigo", "pa.parte", "ma.marca", "mo.modelo"];

async function buscarProductos(
  input: Record<string, unknown>,
  descuentoCliente: number | null
): Promise<string> {
  const descripcion = String(input.descripcion ?? "").trim();
  const marca = String(input.marca ?? "").trim();
  const tipoParte = String(input.tipoParte ?? "").trim();
  const anio = Number(input.anio);
  const soloConExistencia = input.soloConExistencia === true;

  const condiciones: string[] = [];
  const params: unknown[] = [];

  const palabras = condicionesPorPalabra(descripcion, CAMPOS_ARTICULO, condiciones, params);
  if (marca) {
    condiciones.push("l.linea LIKE ?");
    params.push(`%${marca}%`);
  }
  if (tipoParte) {
    condiciones.push("p.parte LIKE ?");
    params.push(`%${tipoParte}%`);
  }
  if (Number.isInteger(anio) && anio > 1950 && anio < 2100) {
    condiciones.push("(a.aini IS NULL OR a.afin IS NULL OR ? BETWEEN a.aini AND a.afin)");
    params.push(anio);
  }
  if (soloConExistencia) condiciones.push("a.existencia > 0");

  const where = condiciones.length > 0 ? condiciones.join(" AND ") : "1";

  // Orden de la lista, en dos criterios:
  //  1) que la descripción EMPIECE por la pieza pedida: en bdav siempre arranca
  //     con ella ("FASCIA DEL AVEO 18-23"), así que esto separa la pieza real de
  //     sus accesorios ("GUIA FASCIA...", "TAPA FASCIA...");
  //  2) el lado/frente, que no filtra —el catálogo a veces no lo captura— pero
  //     sí manda al frente las que dicen DER si pidió la derecha.
  const paramsOrden: unknown[] = [];
  const esLaPieza = expresionRelevancia(
    palabras.requeridas,
    ["a.descripcion"],
    paramsOrden,
    "empieza"
  );
  const coincidePosicion = expresionRelevancia(palabras.opcionales, ["a.descripcion"], paramsOrden);

  // Se cotiza el precio de MOSTRADOR mas IVA (precio_vta * 1.16), no el de
  // lista: precio_vta ya trae el 33% de descuento que llevan todos los
  // articulos, y es lo que el cliente realmente paga en el mostrador.
  //
  // Si el telefono corresponde a un cliente del padron (clientes_descuento) con
  // OTRO descuento, se recalcula desde el precio de lista con el suyo. Cuando
  // su descuento es el mismo del articulo se usa precio_vta tal cual: es ese
  // mismo calculo pero ya redondeado como lo hace el punto de venta, y asi el
  // chat no le canta 50 centavos distintos de lo que muestra la pagina.
  //
  // El porcentaje va interpolado en el SQL (no se puede parametrizar dentro de
  // una expresion aritmetica con este driver), asi que antes se exige que sea
  // un numero finito entre 0 y 100; cualquier otra cosa cotiza de mostrador.
  const descuento =
    descuentoCliente !== null && Number.isFinite(descuentoCliente) && descuentoCliente >= 0 && descuentoCliente < 100
      ? descuentoCliente
      : null;
  const precioBase =
    descuento === null
      ? "IFNULL(a.precio_vta, 0)"
      : `CASE WHEN a.descuento = ${descuento} THEN IFNULL(a.precio_vta, 0)
              ELSE ROUND(IFNULL(a.precio_lista, 0) * ${(100 - descuento) / 100}, 2) END`;
  const filas = await consultaBdav<FilaProducto>(
    `SELECT a.codigo, a.descripcion,
            IFNULL(l.linea, '') AS marca, IFNULL(p.parte, '') AS tipoParte,
            a.aini, a.afin,
            ${precioBase} AS precioSinIva,
            ROUND((${precioBase}) * 1.16, 2) AS precioConIva,
            IFNULL(a.existencia, 0) AS existencia,
            a.localizacion
       FROM articulos a
       LEFT JOIN lineas l ON l.id = a.id_linea
       LEFT JOIN partes p ON p.id = a.id_parte
      WHERE ${where}
      ORDER BY ${esLaPieza} DESC, ${coincidePosicion} DESC,
               (a.existencia > 0) DESC, a.precio_vta ASC
      LIMIT ${MAX_RESULTADOS}`,
    [...params, ...paramsOrden]
  );

  if (filas.length === 0) {
    return JSON.stringify({ resultados: [], nota: "Sin coincidencias en el catálogo." });
  }

  // Enriquecimiento para la lógica de entrega: disponibilidad con el proveedor
  // (Aldo, solo primeros resultados; precioAldo cachea y limita concurrencia)
  // y resumen de usado equivalente en la Bodega, en paralelo.
  const [disponibilidadAldo, usadoPorLlave] = await Promise.all([
    Promise.all(
      filas.map(async (f, i) => {
        if (i >= MAX_CONSULTAS_ALDO) return null; // no consultado
        const aldo = await precioAldo(f.codigo);
        return aldo.encontrado ? (aldo.existencia ?? 0) : 0;
      })
    ),
    resumenUsadoPorLlave(filas),
  ]);

  const resultados = filas.map((f, i) => {
    const llave = llaveUsado(f);
    return {
      codigo: f.codigo,
      descripcion: f.descripcion,
      marca: f.marca,
      tipoParte: f.tipoParte,
      aini: f.aini,
      afin: f.afin,
      precioSinIva: f.precioSinIva,
      precioConIva: f.precioConIva,
      // Entrega inmediata = existencia en tienda (matriz).
      entregaInmediata: f.existencia,
      // Sobre pedido = disponibilidad con el proveedor; al cliente se le dice
      // "la tengo sobre pedido" sin plazos ni mencionar al proveedor
      // (null = no consultado; el precio sigue siendo precioConIva).
      sobrePedido: disponibilidadAldo[i],
      // Piezas usadas equivalentes en la Bodega Usado (null = sin dato).
      usado: (llave && usadoPorLlave.get(llave)) || null,
      // "Taiwán" cuando no hay existencia propia y sí con el proveedor: esa
      // pieza es de importación y el cliente tiene que saberlo (null = nada
      // que observar).
      observacion: observacionOrigen(f.existencia, disponibilidadAldo[i]),
      localizacion: f.localizacion,
    };
  });

  return JSON.stringify({ total: resultados.length, resultados });
}

interface FilaPiezaUsada {
  codigo: string;
  descripcion: string;
  marca: string;
  modelo: string;
  tipoParte: string;
  anioInicio: number | null;
  anioFin: number | null;
  precioSinIva: number;
  precioConIva: number;
  existencia: number;
  ubicacion: string | null;
}

async function buscarPiezasUsadas(input: Record<string, unknown>): Promise<string> {
  const descripcion = String(input.descripcion ?? "").trim();
  const marca = String(input.marca ?? "").trim();
  const anio = Number(input.anio);

  const condiciones: string[] = ["p.existencia > 0"];
  const params: unknown[] = [];

  // Cada palabra cruza descripción/código/parte/marca/modelo: "puerta
  // silverado" encuentra parte=PUERTA + modelo=SILVERADO aunque la descripción
  // no traiga el nombre del modelo. Se busca por raíz ("delantera" → "delanter")
  // porque la bodega captura con género variable ("DELANTERO(A)").
  const palabras = condicionesPorPalabra(descripcion, CAMPOS_USADA, condiciones, params);
  if (marca) {
    // El modelo a veces manda el MODELO del auto aquí ("Journey"): se acepta
    // contra marca O modelo para no anular la búsqueda por ese error.
    condiciones.push("(ma.marca LIKE ? OR mo.modelo LIKE ?)");
    params.push(`%${marca}%`, `%${marca}%`);
  }
  if (Number.isInteger(anio) && anio > 1950 && anio < 2100) {
    // Hay piezas sin rango capturado (0/NULL): se incluyen igual.
    condiciones.push(
      "(IFNULL(p.anio_inicio, 0) = 0 OR IFNULL(p.anio_fin, 0) = 0 OR ? BETWEEN p.anio_inicio AND p.anio_fin)"
    );
    params.push(anio);
  }

  // Relevancia en dos criterios independientes, sin inventar pesos:
  //  1) que el TIPO de parte coincida — sin esto "puerta journey" llena el tope
  //     con espejos cuya descripción dice "5 PUERTAS" (carrocería);
  //  2) que coincida el lado pedido, para que la derecha salga antes que la
  //     izquierda cuando el cliente lo especificó.
  const paramsOrden: unknown[] = [];
  const coincideParte = expresionRelevancia(palabras.requeridas, ["pa.parte"], paramsOrden);
  const coincidePosicion = expresionRelevancia(palabras.opcionales, ["p.descripcion"], paramsOrden);

  // Diversidad: máximo 3 piezas por TIPO de parte (ROW_NUMBER por id_parte).
  // Sin esto, una búsqueda como "puerta journey" llena el tope con 15 quintas
  // puertas baratas y la puerta lateral (más cara) nunca aparece.
  // Ojo con el orden de los ?: los de coincideParte van primero (SELECT interno).
  const filas = await consultaUsadas<
    FilaPiezaUsada & {
      idPieza: number;
      fotoNombre: string | null;
      rn: number;
      relevanteParte: number | null;
      relevantePosicion: number | null;
    }
  >(
    `SELECT * FROM (
       SELECT p.id_pieza AS idPieza, p.codigo, p.descripcion,
              IFNULL(ma.marca, '') AS marca, IFNULL(mo.modelo, '') AS modelo,
              IFNULL(pa.parte, '') AS tipoParte,
              NULLIF(p.anio_inicio, 0) AS anioInicio, NULLIF(p.anio_fin, 0) AS anioFin,
              IFNULL(p.precio, 0) AS precioSinIva,
              ROUND(IFNULL(p.precio, 0) * 1.16, 2) AS precioConIva,
              IFNULL(p.existencia, 0) AS existencia,
              CONCAT_WS(' / ', md.modulo, u.casillero) AS ubicacion,
              (SELECT pi.nombre_imagen FROM piezas_imagenes pi
                WHERE pi.id_pieza = p.id_pieza AND pi.activo = 1
                  AND pi.consecutivo >= 1
                ORDER BY pi.consecutivo LIMIT 1) AS fotoNombre,
              ${coincideParte} AS relevanteParte,
              ${coincidePosicion} AS relevantePosicion,
              ROW_NUMBER() OVER (
                PARTITION BY p.id_parte
                ORDER BY (p.precio > 0) DESC, p.precio ASC
              ) AS rn
         FROM piezas p
         LEFT JOIN partes pa ON pa.id_parte = p.id_parte
         LEFT JOIN modelos mo ON mo.id_modelo = p.id_modelo
         LEFT JOIN marcas ma ON ma.id_marca = mo.id_marca
         LEFT JOIN ubicaciones u ON u.id_ubicacion = p.id_ubicacion
         LEFT JOIN modulos md ON md.id_modulo = u.id_modulo
        WHERE ${condiciones.join(" AND ")}
     ) sub
     WHERE sub.rn <= 3
     ORDER BY sub.relevanteParte DESC, sub.relevantePosicion DESC,
              (sub.precioSinIva > 0) DESC, sub.precioSinIva ASC
     LIMIT ${MAX_RESULTADOS}`,
    [...paramsOrden, ...params]
  );

  if (filas.length === 0) {
    return JSON.stringify({
      resultados: [],
      nota: "Sin piezas usadas con existencia que coincidan en la Bodega Usado.",
    });
  }
  // `foto` (proxy interno) es lo que el agente inserta en el chat web;
  // `fotoPublica` la usa el canal WhatsApp para adjuntar la imagen real;
  // `idPieza` es la referencia con la que agregar_al_pedido mete una usada al
  // pedido (el código de la Bodega no es único).
  const resultados = filas.map(
    ({ idPieza, fotoNombre, rn: _rn, relevanteParte: _rp, relevantePosicion: _rpos, ...pieza }) => ({
      idPieza,
      ...pieza,
      foto: fotoNombre ? `/api/usadas/foto?n=${encodeURIComponent(fotoNombre)}` : null,
      fotoPublica: fotoNombre ? urlFotoUsadaPublica(fotoNombre) : null,
    })
  );
  return JSON.stringify({ total: resultados.length, resultados });
}

export async function ejecutarHerramienta(
  uso: UsoHerramienta,
  descuentoCliente: number | null = null,
  actor: ActorVendedor = { tipo: "anonimo" }
): Promise<string> {
  // Las tools de pedido deciden por su cuenta quién puede usarlas y devuelven
  // su propio { error }: no pasan por el catch de abajo para que un "no puedes
  // pedir" no salga disfrazado de "no fue posible consultar el catálogo".
  if (esHerramientaPedido(uso.name)) return ejecutarHerramientaPedido(uso, actor);
  try {
    if (uso.name === "buscar_productos") return await buscarProductos(uso.input, descuentoCliente);
    if (uso.name === "buscar_piezas_usadas") return await buscarPiezasUsadas(uso.input);
    if (uso.name === "listar_marcas") {
      const marcas = await consultaBdav<{ marca: string }>(
        "SELECT linea AS marca FROM lineas WHERE linea <> '' ORDER BY linea"
      );
      return JSON.stringify({ marcas: marcas.map((m) => m.marca) });
    }
    if (uso.name === "listar_tipos_parte") {
      const partes = await consultaBdav<{ parte: string }>(
        "SELECT parte FROM partes WHERE parte <> '' ORDER BY parte"
      );
      return JSON.stringify({ tiposParte: partes.map((p) => p.parte) });
    }
    return JSON.stringify({ error: "Herramienta desconocida" });
  } catch (error) {
    console.error("Error en herramienta del Vendedor IA:", error);
    return JSON.stringify({ error: "No fue posible consultar el catálogo" });
  }
}

export interface MensajeConversacion {
  rol: "usuario" | "agente";
  texto: string;
}

export interface OpcionesVendedor {
  pregunta: string;
  historial: MensajeConversacion[];
  modelo: string;
  /** Canal de la conversación: 'web' muestra fotos, 'whatsapp' no. */
  canal?: CanalVendedor;
  /** Descuento del cliente identificado por su teléfono, en por ciento. Si es
   *  null (número desconocido o canal sin teléfono) se cotiza de mostrador. */
  descuentoCliente?: number | null;
  /** Quién habla: decide si entran las herramientas de pedido y para quién se
   *  captura. Sin actor (o anónimo) Vico solo cotiza, como siempre. */
  actor?: ActorVendedor;
  /** Recibe los códigos que devolvió cada búsqueda de productos (para fotos). */
  alCodigos?: (codigos: string[]) => void;
  /** Recibe código → URL pública de la foto de cada pieza usada encontrada
   *  (para que el canal WhatsApp adjunte la imagen real). */
  alFotosUsadas?: (fotos: Array<{ codigo: string; url: string }>) => void;
  /** Recibe, tal cual, el arreglo `resultados` que devolvió cada búsqueda
   *  (buscar_productos / buscar_piezas_usadas) con el precio que el modelo vio.
   *  Sirve para que el mostrador arme sus renglones de "Agregar al pedido"
   *  sin volver a consultar el catálogo. */
  alResultados?: (herramienta: string, resultados: unknown[]) => void;
  /** Fragmento de texto en curso (para streaming del canal web). */
  alTexto?: (fragmento: string) => void;
  /** Descarta el borrador porque viene una ronda de herramientas (web). */
  alReinicio?: () => void;
  /** Estado de progreso ("Buscando productos"). */
  alEstado?: (texto: string) => void;
}

/**
 * Corre el agente Vendedor IA y devuelve el texto final. Si se pasan callbacks,
 * además emite el progreso (para el streaming del canal web).
 */
function mensajeCorreccion(inventadas: CifrasInventadas): string {
  const partes: string[] = [];
  if (inventadas.codigos.length) partes.push(`códigos ${inventadas.codigos.join(", ")}`);
  if (inventadas.precios.length) partes.push(`precios ${inventadas.precios.join(", ")}`);
  return (
    `CORRECCIÓN INTERNA: tu respuesta trae ${partes.join(" y ")}, que NO vienen del catálogo. ` +
    `El cliente NO vio ese mensaje, así que responde ÚNICAMENTE con el mensaje corregido, tal ` +
    `cual lo va a leer. No menciones esta corrección ni digas "confirmado", "esos datos son ` +
    `correctos" o "te lo dejo de nuevo": para el cliente es tu primera respuesta. Copia los ` +
    `códigos y precios exactamente como los devolvió la búsqueda; lo que no tengas, pregúntalo.`
  );
}

export async function correrVendedor(op: OpcionesVendedor): Promise<string> {
  const mensajes: Anthropic.MessageParam[] = op.historial.map((m) => ({
    role: m.rol === "usuario" ? "user" : "assistant",
    content: m.texto.slice(0, 4000),
  }));
  mensajes.push({ role: "user", content: op.pregunta });

  const actor: ActorVendedor = op.actor ?? { tipo: "anonimo" };
  const sistema = promptSistema(new Date().toLocaleDateString("sv-SE"), op.canal ?? "whatsapp", actor);
  const herramientas = herramientasPara(actor);
  let textoFinal = "";
  // Lo que devolvieron las búsquedas, para revisar que la respuesta no cite
  // códigos ni precios que el modelo se haya inventado.
  const catalogo = catalogoVacio();
  for (const previo of op.historial) {
    if (previo.rol !== "usuario") registrarRespuestaPrevia(previo.texto, catalogo);
  }
  let yaCorregido = false;

  for (let ronda = 0; ronda < MAX_ITERACIONES; ronda++) {
    const ultimaRonda = ronda === MAX_ITERACIONES - 1;
    let textoRonda = "";
    const resultado = await correrTurnoAgente({
      modelo: op.modelo,
      sistema,
      herramientas,
      mensajes,
      maxTokens: MAX_TOKENS,
      sinHerramientas: ultimaRonda,
      alTexto: (frag) => {
        textoRonda += frag;
        op.alTexto?.(frag);
      },
    });

    if (resultado.usos.length === 0) {
      textoFinal = textoRonda; // se conserva por si la corrección no alcanza
      const inventadas = cifrasInventadas(textoRonda, catalogo);
      const hayInventadas = inventadas.codigos.length > 0 || inventadas.precios.length > 0;
      if (hayInventadas && !yaCorregido && !ultimaRonda) {
        yaCorregido = true;
        console.warn("Vendedor IA citó datos fuera del catálogo:", inventadas);
        mensajes.push({ role: "assistant", content: textoRonda });
        mensajes.push({ role: "user", content: mensajeCorreccion(inventadas) });
        op.alReinicio?.(); // el chat web descarta el texto ya emitido
        continue;
      }
      break;
    }

    // Viene ronda de herramientas: el web descarta el preámbulo ya emitido.
    op.alReinicio?.();
    mensajes.push({ role: "assistant", content: resultado.contenido });

    const resultados: Anthropic.ToolResultBlockParam[] = [];
    for (const uso of resultado.usos) {
      op.alEstado?.(ETIQUETA_HERRAMIENTA[uso.name] ?? "Consultando el catálogo");
      const contenido = await ejecutarHerramienta(uso, op.descuentoCliente ?? null, actor);
      registrarResultado(contenido, catalogo);
      // Reporta los códigos que devolvió una búsqueda (para que el canal
      // WhatsApp pueda adjuntar las fotos de los que el agente mencione).
      if (
        (uso.name === "buscar_productos" || uso.name === "buscar_piezas_usadas") &&
        (op.alCodigos || op.alFotosUsadas || op.alResultados)
      ) {
        try {
          const datos = JSON.parse(contenido) as {
            resultados?: Array<{ codigo?: string; fotoPublica?: string | null }>;
          };
          const filas = datos.resultados ?? [];
          // El arreglo completo, sin filtrar: quien lo recibe decide qué campos
          // le sirven (precio, existencia, idPieza...) sin otra consulta.
          if (op.alResultados && Array.isArray(datos.resultados)) op.alResultados(uso.name, datos.resultados);
          const codigos = filas
            .map((r) => r.codigo)
            .filter((c): c is string => typeof c === "string" && c.length > 0);
          if (codigos.length && op.alCodigos) op.alCodigos(codigos);
          if (uso.name === "buscar_piezas_usadas" && op.alFotosUsadas) {
            const fotos = filas
              .filter(
                (r): r is { codigo: string; fotoPublica: string } =>
                  typeof r.codigo === "string" && typeof r.fotoPublica === "string"
              )
              .map((r) => ({ codigo: r.codigo, url: r.fotoPublica }));
            if (fotos.length) op.alFotosUsadas(fotos);
          }
        } catch {
          // resultado no parseable: se ignora para las fotos
        }
      }
      resultados.push({ type: "tool_result", tool_use_id: uso.id, content: contenido });
    }
    mensajes.push({ role: "user", content: resultados });
  }

  return textoFinal;
}
