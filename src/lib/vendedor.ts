import type Anthropic from "@anthropic-ai/sdk";
import { consultaBdav } from "@/lib/db";
import { consultaUsadas } from "@/lib/db-usadas";
import { precioAldo } from "@/lib/aldo";
import { correrTurnoAgente, type UsoHerramienta } from "@/lib/agente-modelo";
import { condicionesPorPalabra, expresionRelevancia } from "@/lib/busqueda";
import {
  catalogoVacio,
  cifrasInventadas,
  registrarRespuestaPrevia,
  registrarResultado,
  type CifrasInventadas,
} from "@/lib/vendedor-cifras";

// Núcleo del agente "Vendedor IA": prompt, herramientas de catálogo y el loop
// del agente. Lo comparten el endpoint web (streaming) y el de WhatsApp (una
// sola respuesta), para no duplicar el comportamiento.

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
};

export type CanalVendedor = "web" | "whatsapp";

// Fotos públicas de las piezas usadas (mismo origen que el proxy /api/usadas/foto).
// El archivo es el nombre_imagen que registra piezas_imagenes.
const BASE_FOTOS_USADAS = "https://sistema.apvidaurri.com/imagenes_piezas";

export function urlFotoUsadaPublica(nombreImagen: string): string {
  return `${BASE_FOTOS_USADAS}/${encodeURIComponent(nombreImagen)}`;
}

export function promptSistema(hoy: string, canal: CanalVendedor = "whatsapp"): string {
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
  return `Eres el vendedor de AUTO PARTES VIDAURRI atendiendo a un cliente por WhatsApp. Vidaurri vende autopartes de colisión (cofres, defensas, parrillas, faros, tolvas, guías, molduras, etc.) por marca, modelo y rango de años. Hoy es ${hoy}.

Consultas el catálogo real con tus herramientas:
- buscar_productos: por descripción (incluye modelo y años, p.ej. "COFRE VERSA 15-19"), acotando por marca, tipo de parte y año. Devuelve por producto: precio con IVA, entregaInmediata (piezas en tienda), sobrePedido (disponibilidad para conseguirla sobre pedido) y usado (piezas usadas equivalentes en la Bodega Usado).
- buscar_piezas_usadas: detalle del inventario de la BODEGA USADO (piezas usadas: puertas, faros, calaveras, espejos, elevadores, computadoras...). Úsala cuando el cliente quiera ver las opciones de usado.
- listar_marcas / listar_tipos_parte: qué hay en catálogo.

LÓGICA DE ENTREGA Y PRECIOS (obligatoria, síguela SIEMPRE):
- *Entrega inmediata*: cuando entregaInmediata > 0 (existencia en tienda). Precio: precioConIva.
- *Sobre pedido*: cuando NO hay entrega inmediata pero sobrePedido > 0 (o "Mas de N"). Di "la tengo sobre pedido" (SIN prometer días de entrega ni plazos). El precio es EL MISMO precioConIva de la pieza nueva; NUNCA menciones al proveedor ni des otro precio por esta vía.
- *Usado*: cuando usado trae piezas > 0 hay equivalentes usados en nuestra Bodega Usado. Ofrécelo SOLO si usado.desdeConIva es MENOR que el precioConIva de la nueva (el usado se ofrece como alternativa económica: si sale igual o más caro, NO lo menciones, recomienda la nueva y ya). Cuando sí lo ofrezcas, di "también la tengo usada desde $X" con usado.desdeConIva y ACLARA siempre que es pieza USADA. El precio del usado es el del usado (con IVA), no el de la nueva. Detalles con buscar_piezas_usadas.
- Si una opción NO existe (sobrePedido en 0 o null, usado null o con 0 piezas), simplemente NO la menciones; no digas "no hay usado" ni "no hay con proveedor".
- Si no hay entrega inmediata, ni sobre pedido, ni usado, dilo claro y ofrece tomar sus datos para conseguirla.

ESTILO WHATSAPP (muy importante):
- Responde CORTO y natural, como un chat de WhatsApp. Nada de párrafos largos ni tablas.
- Usa el formato de WhatsApp: *negritas* con un solo asterisco (NO markdown de tablas, NO títulos con #).
- Muestra máximo 2 o 3 productos, los más relevantes. Cada uno en 1-2 líneas: nombre/código, *precio con IVA* y la forma de entrega (inmediata / sobre pedido / usado).
- Puedes usar pocos emojis para dar calidez (👍 🔧 📦 💵), sin exagerar.
- Si falta un dato para acertar (modelo, año, si es sedán/hatchback, lado izquierdo/derecho), pregúntalo en una línea.
- SIEMPRE cotiza con precioConIva. NUNCA presentes precioSinIva (el precio de lista) como si
  fuera el precio: solo dilo si el cliente pide expresamente el precio sin IVA, aclarándolo.
- NUNCA escribas de memoria un código ni un precio: cópialos carácter por carácter del
  resultado de la búsqueda. Si el dato no está ahí, no lo inventes — dilo o pregúntalo.
- ANTES de decir que no hay algo, vuelve a buscar con menos palabras (solo la pieza y el
  modelo, sin año ni lado) y con otra forma de nombrarla. Nunca contestes que no tienes
  una pieza después de una sola búsqueda que salió vacía.
- Si aun así no encuentras nada, pide más datos amablemente.${instruccionFoto}

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
      "Busca piezas USADAS con existencia en el inventario de la Bodega Usado (sucursal de piezas usadas, base aparte del catálogo de nuevas). Devuelve hasta 15 piezas con precio (sin y con IVA), años de aplicación y ubicación.",
    // cache_control en la última herramienta: cachea el prefijo tools+system.
    cache_control: { type: "ephemeral" },
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

async function buscarProductos(input: Record<string, unknown>): Promise<string> {
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

  // Precio PUBLICO = precio_lista + IVA, el mismo criterio que la web
  // (vidaurri-page/src/lib/catalogo.ts). `precio_vta` es el precio de mostrador
  // ya con descuento: si el chat cotizara con ese, el cliente veria un numero
  // en WhatsApp y otro distinto en la pagina.
  const filas = await consultaBdav<FilaProducto>(
    `SELECT a.codigo, a.descripcion,
            IFNULL(l.linea, '') AS marca, IFNULL(p.parte, '') AS tipoParte,
            a.aini, a.afin,
            IFNULL(a.precio_lista, 0) AS precioSinIva,
            ROUND(IFNULL(a.precio_lista, 0) * 1.16, 2) AS precioConIva,
            IFNULL(a.existencia, 0) AS existencia,
            a.localizacion
       FROM articulos a
       LEFT JOIN lineas l ON l.id = a.id_linea
       LEFT JOIN partes p ON p.id = a.id_parte
      WHERE ${where}
      ORDER BY ${esLaPieza} DESC, ${coincidePosicion} DESC,
               (a.existencia > 0) DESC, a.precio_lista ASC
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
  // `fotoPublica` la usa el canal WhatsApp para adjuntar la imagen real.
  const resultados = filas.map(
    ({
      idPieza: _id,
      fotoNombre,
      rn: _rn,
      relevanteParte: _rp,
      relevantePosicion: _rpos,
      ...pieza
    }) => ({
    ...pieza,
      foto: fotoNombre ? `/api/usadas/foto?n=${encodeURIComponent(fotoNombre)}` : null,
      fotoPublica: fotoNombre ? urlFotoUsadaPublica(fotoNombre) : null,
    })
  );
  return JSON.stringify({ total: resultados.length, resultados });
}

export async function ejecutarHerramienta(uso: UsoHerramienta): Promise<string> {
  try {
    if (uso.name === "buscar_productos") return await buscarProductos(uso.input);
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
  /** Recibe los códigos que devolvió cada búsqueda de productos (para fotos). */
  alCodigos?: (codigos: string[]) => void;
  /** Recibe código → URL pública de la foto de cada pieza usada encontrada
   *  (para que el canal WhatsApp adjunte la imagen real). */
  alFotosUsadas?: (fotos: Array<{ codigo: string; url: string }>) => void;
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

  const sistema = promptSistema(new Date().toLocaleDateString("sv-SE"), op.canal ?? "whatsapp");
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
      herramientas: HERRAMIENTAS,
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
      const contenido = await ejecutarHerramienta(uso);
      registrarResultado(contenido, catalogo);
      // Reporta los códigos que devolvió una búsqueda (para que el canal
      // WhatsApp pueda adjuntar las fotos de los que el agente mencione).
      if (
        (uso.name === "buscar_productos" || uso.name === "buscar_piezas_usadas") &&
        (op.alCodigos || op.alFotosUsadas)
      ) {
        try {
          const datos = JSON.parse(contenido) as {
            resultados?: Array<{ codigo?: string; fotoPublica?: string | null }>;
          };
          const filas = datos.resultados ?? [];
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
