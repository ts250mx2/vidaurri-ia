import type Anthropic from "@anthropic-ai/sdk";
import { consultaBdav } from "@/lib/db";
import { consultaUsadas } from "@/lib/db-usadas";
import { precioAldo } from "@/lib/aldo";
import { correrTurnoAgente, type UsoHerramienta } from "@/lib/agente-modelo";

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

export function promptSistema(hoy: string, canal: CanalVendedor = "whatsapp"): string {
  // En el panel web se pueden mostrar imágenes; en WhatsApp no (llegaría como
  // texto crudo), así que solo se pide la foto para el canal web.
  const instruccionFoto =
    canal === "web"
      ? `\n- OBLIGATORIO: cada vez que menciones un producto concreto (con su código), DEBAJO de esa línea agrega SIEMPRE su foto en una línea aparte con este formato exacto: ![](/api/articulos/foto?codigo=CODIGO) — reemplaza CODIGO por el código EXACTO que te dio la herramienta. Ejemplo:
  *Cofre Versa 15-19* (CNVE15) — $1,709.84 c/IVA 📦
  ![](/api/articulos/foto?codigo=CNVE15)
  Nunca omitas la foto de un producto que sugieres. Si el artículo no tuviera foto, no se mostrará y no pasa nada, pero igual incluye la línea.`
      : `\n- AL FINAL de tu respuesta agrega SIEMPRE una última línea técnica con los códigos EXACTOS de los productos que sugeriste, con este formato: [[FOTOS: CODIGO1, CODIGO2]] (máximo 3, usa los códigos EXACTOS que te dio la herramienta). Esa línea es SOLO para el sistema (sirve para enviar las fotos); el cliente no la verá, así que no la comentes ni la expliques. Si no sugeriste ningún producto, no pongas la línea.`;
  return `Eres el vendedor de AUTO PARTES VIDAURRI atendiendo a un cliente por WhatsApp. Vidaurri vende autopartes de colisión (cofres, defensas, parrillas, faros, tolvas, guías, molduras, etc.) por marca, modelo y rango de años. Hoy es ${hoy}.

Consultas el catálogo real con tus herramientas:
- buscar_productos: por descripción (incluye modelo y años, p.ej. "COFRE VERSA 15-19"), acotando por marca, tipo de parte y año. Devuelve por producto: precio con IVA, entregaInmediata (piezas en tienda), entregaCincoDias (disponibilidad con nuestro proveedor) y usado (piezas usadas equivalentes en la Bodega Usado).
- buscar_piezas_usadas: detalle del inventario de la BODEGA USADO (piezas usadas: puertas, faros, calaveras, espejos, elevadores, computadoras...). Úsala cuando el cliente quiera ver las opciones de usado.
- listar_marcas / listar_tipos_parte: qué hay en catálogo.

LÓGICA DE ENTREGA Y PRECIOS (obligatoria, síguela SIEMPRE):
- *Entrega inmediata*: cuando entregaInmediata > 0 (existencia en tienda). Precio: precioConIva.
- *Entrega en 5 días después de pagar*: cuando NO hay entrega inmediata pero entregaCincoDias > 0 (o "Mas de N"). El precio es EL MISMO precioConIva de la pieza nueva; NUNCA menciones al proveedor ni des otro precio por esta vía.
- *Usado*: cuando usado trae piezas > 0 hay equivalentes usados en nuestra Bodega Usado; ofrécelo como alternativa económica ("también la tengo usada desde $X") usando usado.desdeConIva, y ACLARA siempre que es pieza USADA. El precio del usado es el del usado (con IVA), no el de la nueva. Detalles con buscar_piezas_usadas.
- Si una opción NO existe (entregaCincoDias en 0 o null, usado null o con 0 piezas), simplemente NO la menciones; no digas "no hay usado" ni "no hay con proveedor".
- Si no hay entrega inmediata, ni en 5 días, ni usado, dilo claro y ofrece tomar sus datos para conseguirla.

ESTILO WHATSAPP (muy importante):
- Responde CORTO y natural, como un chat de WhatsApp. Nada de párrafos largos ni tablas.
- Usa el formato de WhatsApp: *negritas* con un solo asterisco (NO markdown de tablas, NO títulos con #).
- Muestra máximo 2 o 3 productos, los más relevantes. Cada uno en 1-2 líneas: nombre/código, *precio con IVA* y la forma de entrega (inmediata / 5 días / usado).
- Puedes usar pocos emojis para dar calidez (👍 🔧 📦 💵), sin exagerar.
- Si falta un dato para acertar (modelo, año, si es sedán/hatchback, lado izquierdo/derecho), pregúntalo en una línea.
- El precio que le importa al cliente es el de CON IVA; menciónalo. Solo da el de sin IVA si lo piden.
- Si no encuentras nada, pide más datos amablemente.${instruccionFoto}

Reglas:
- NUNCA inventes productos, códigos ni precios: solo lo que devuelvan las herramientas.
- Montos en pesos: $#,##0.00.
- Si preguntan algo ajeno a comprar autopartes de Vidaurri, contesta amable que solo ayudas con eso.`;
}

export const HERRAMIENTAS: Anthropic.Tool[] = [
  {
    name: "buscar_productos",
    description:
      "Busca artículos en el catálogo de Vidaurri. La descripción incluye normalmente el modelo y el rango de años. Devuelve hasta 15 productos con precio (con y sin IVA), entregaInmediata (existencia en tienda), entregaCincoDias (disponibilidad con el proveedor, solo en los primeros resultados) y usado (resumen de piezas usadas equivalentes en la Bodega Usado).",
    input_schema: {
      type: "object" as const,
      properties: {
        descripcion: {
          type: "string",
          description:
            "Palabras a buscar en la descripción o el código, p.ej. 'cofre versa'. Todas las palabras deben aparecer.",
        },
        marca: { type: "string", description: "Marca de auto (línea), opcional. Ej. NISSAN" },
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
            "Palabras a buscar en la descripción o el código de la pieza, p.ej. 'puerta sonic'. Todas las palabras deben aparecer.",
        },
        marca: { type: "string", description: "Marca de auto, opcional. Ej. CHEVROLET" },
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
function llaveUsado(f: FilaProducto): string | null {
  const raiz = raizParte(f.tipoParte);
  const marca = f.marca.trim();
  if (!raiz || !marca) return null;
  return `${raiz}|${marca}|${f.aini ?? ""}|${f.afin ?? ""}`;
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
      "pa.parte LIKE ?",
      // La marca puede venir compuesta en la Bodega ("DODGE / CHRYSLER").
      "(ma.marca LIKE ? OR ? LIKE CONCAT('%', ma.marca, '%'))",
    ];
    params.push(llave, `${raizParte(f.tipoParte)}%`, `%${f.marca.trim()}%`, f.marca.trim());
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

async function buscarProductos(input: Record<string, unknown>): Promise<string> {
  const descripcion = String(input.descripcion ?? "").trim();
  const marca = String(input.marca ?? "").trim();
  const tipoParte = String(input.tipoParte ?? "").trim();
  const anio = Number(input.anio);
  const soloConExistencia = input.soloConExistencia === true;

  const condiciones: string[] = [];
  const params: unknown[] = [];

  const palabras = descripcion.split(/\s+/).filter(Boolean).slice(0, 6);
  for (const palabra of palabras) {
    condiciones.push("(a.descripcion LIKE ? OR a.codigo LIKE ?)");
    params.push(`%${palabra}%`, `%${palabra}%`);
  }
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

  const filas = await consultaBdav<FilaProducto>(
    `SELECT a.codigo, a.descripcion,
            IFNULL(l.linea, '') AS marca, IFNULL(p.parte, '') AS tipoParte,
            a.aini, a.afin,
            IFNULL(a.precio_vta, 0) AS precioSinIva,
            ROUND(IFNULL(a.precio_vta, 0) * 1.16, 2) AS precioConIva,
            IFNULL(a.existencia, 0) AS existencia,
            a.localizacion
       FROM articulos a
       LEFT JOIN lineas l ON l.id = a.id_linea
       LEFT JOIN partes p ON p.id = a.id_parte
      WHERE ${where}
      ORDER BY (a.existencia > 0) DESC, a.precio_vta ASC
      LIMIT ${MAX_RESULTADOS}`,
    params
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
      // Entrega en 5 días después de pagar = disponibilidad con el proveedor
      // (null = no consultado; el precio al cliente sigue siendo precioConIva).
      entregaCincoDias: disponibilidadAldo[i],
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

  const palabras = descripcion.split(/\s+/).filter(Boolean).slice(0, 6);
  for (const palabra of palabras) {
    condiciones.push("(p.descripcion LIKE ? OR p.codigo LIKE ?)");
    params.push(`%${palabra}%`, `%${palabra}%`);
  }
  if (marca) {
    condiciones.push("ma.marca LIKE ?");
    params.push(`%${marca}%`);
  }
  if (Number.isInteger(anio) && anio > 1950 && anio < 2100) {
    // Hay piezas sin rango capturado (0/NULL): se incluyen igual.
    condiciones.push(
      "(IFNULL(p.anio_inicio, 0) = 0 OR IFNULL(p.anio_fin, 0) = 0 OR ? BETWEEN p.anio_inicio AND p.anio_fin)"
    );
    params.push(anio);
  }

  const filas = await consultaUsadas<FilaPiezaUsada>(
    `SELECT p.codigo, p.descripcion,
            IFNULL(ma.marca, '') AS marca, IFNULL(mo.modelo, '') AS modelo,
            IFNULL(pa.parte, '') AS tipoParte,
            NULLIF(p.anio_inicio, 0) AS anioInicio, NULLIF(p.anio_fin, 0) AS anioFin,
            IFNULL(p.precio, 0) AS precioSinIva,
            ROUND(IFNULL(p.precio, 0) * 1.16, 2) AS precioConIva,
            IFNULL(p.existencia, 0) AS existencia,
            CONCAT_WS(' / ', md.modulo, u.casillero) AS ubicacion
       FROM piezas p
       LEFT JOIN partes pa ON pa.id_parte = p.id_parte
       LEFT JOIN modelos mo ON mo.id_modelo = p.id_modelo
       LEFT JOIN marcas ma ON ma.id_marca = mo.id_marca
       LEFT JOIN ubicaciones u ON u.id_ubicacion = p.id_ubicacion
       LEFT JOIN modulos md ON md.id_modulo = u.id_modulo
      WHERE ${condiciones.join(" AND ")}
      ORDER BY (p.precio > 0) DESC, p.precio ASC
      LIMIT ${MAX_RESULTADOS}`,
    params
  );

  if (filas.length === 0) {
    return JSON.stringify({
      resultados: [],
      nota: "Sin piezas usadas con existencia que coincidan en la Bodega Usado.",
    });
  }
  return JSON.stringify({ total: filas.length, resultados: filas });
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
export async function correrVendedor(op: OpcionesVendedor): Promise<string> {
  const mensajes: Anthropic.MessageParam[] = op.historial.map((m) => ({
    role: m.rol === "usuario" ? "user" : "assistant",
    content: m.texto.slice(0, 4000),
  }));
  mensajes.push({ role: "user", content: op.pregunta });

  const sistema = promptSistema(new Date().toLocaleDateString("sv-SE"), op.canal ?? "whatsapp");
  let textoFinal = "";

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
      textoFinal = textoRonda;
      break;
    }

    // Viene ronda de herramientas: el web descarta el preámbulo ya emitido.
    op.alReinicio?.();
    mensajes.push({ role: "assistant", content: resultado.contenido });

    const resultados: Anthropic.ToolResultBlockParam[] = [];
    for (const uso of resultado.usos) {
      op.alEstado?.(ETIQUETA_HERRAMIENTA[uso.name] ?? "Consultando el catálogo");
      const contenido = await ejecutarHerramienta(uso);
      // Reporta los códigos que devolvió una búsqueda de productos (para que el
      // canal WhatsApp pueda adjuntar las fotos de los que el agente mencione).
      if (uso.name === "buscar_productos" && op.alCodigos) {
        try {
          const datos = JSON.parse(contenido) as { resultados?: Array<{ codigo?: string }> };
          const codigos = (datos.resultados ?? [])
            .map((r) => r.codigo)
            .filter((c): c is string => typeof c === "string" && c.length > 0);
          if (codigos.length) op.alCodigos(codigos);
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
