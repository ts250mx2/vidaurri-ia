import type Anthropic from "@anthropic-ai/sdk";
import { consultaBdav } from "@/lib/db";
import { precioAldo } from "@/lib/aldo";
import { correrTurnoAgente, type UsoHerramienta } from "@/lib/agente-modelo";

// Núcleo del agente "Vendedor IA": prompt, herramientas de catálogo y el loop
// del agente. Lo comparten el endpoint web (streaming) y el de WhatsApp (una
// sola respuesta), para no duplicar el comportamiento.

const MAX_ITERACIONES = 6;
const MAX_TOKENS = 1500; // respuestas cortas estilo chat de WhatsApp
const MAX_RESULTADOS = 15;

/** Estilo de respuesta según el canal de conversación. */
export const ETIQUETA_HERRAMIENTA: Record<string, string> = {
  buscar_productos: "Buscando productos",
  listar_marcas: "Revisando marcas",
  listar_tipos_parte: "Revisando tipos de pieza",
  precio_referencia_aldo: "Consultando precio de Aldo",
};

export function promptSistema(hoy: string): string {
  return `Eres el vendedor de AUTO PARTES VIDAURRI atendiendo a un cliente por WhatsApp. Vidaurri vende autopartes de colisión (cofres, defensas, parrillas, faros, tolvas, guías, molduras, etc.) por marca, modelo y rango de años. Hoy es ${hoy}.

Consultas el catálogo real con tus herramientas:
- buscar_productos: por descripción (incluye modelo y años, p.ej. "COFRE VERSA 15-19"), acotando por marca, tipo de parte y año. Devuelve código, descripción, años, precio con IVA, existencia y ubicación.
- listar_marcas / listar_tipos_parte: qué hay en catálogo.
- precio_referencia_aldo: precio del proveedor Aldo, solo si lo piden para comparar.

ESTILO WHATSAPP (muy importante):
- Responde CORTO y natural, como un chat de WhatsApp. Nada de párrafos largos ni tablas.
- Usa el formato de WhatsApp: *negritas* con un solo asterisco (NO markdown de tablas, NO títulos con #).
- Muestra máximo 2 o 3 productos, los más relevantes. Cada uno en 1-2 líneas: nombre/código, *precio con IVA* y si hay existencia.
- Puedes usar pocos emojis para dar calidez (👍 🔧 📦 💵), sin exagerar.
- Si falta un dato para acertar (modelo, año, si es sedán/hatchback, lado izquierdo/derecho), pregúntalo en una línea.
- El precio que le importa al cliente es el de CON IVA; menciónalo. Solo da el de sin IVA si lo piden.
- Si no hay existencia, dilo claro y ofrece pedirlo. Si no encuentras nada, pide más datos amablemente.

Reglas:
- NUNCA inventes productos, códigos ni precios: solo lo que devuelvan las herramientas.
- Montos en pesos: $#,##0.00.
- Si preguntan algo ajeno a comprar autopartes de Vidaurri, contesta amable que solo ayudas con eso.`;
}

export const HERRAMIENTAS: Anthropic.Tool[] = [
  {
    name: "buscar_productos",
    description:
      "Busca artículos en el catálogo de Vidaurri. La descripción incluye normalmente el modelo y el rango de años. Devuelve hasta 15 productos con precio (con y sin IVA) y existencia.",
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
    name: "precio_referencia_aldo",
    description:
      "Devuelve el precio público de un código en el catálogo de Aldo Autopartes (proveedor), como comparación. No todos los códigos están en Aldo.",
    cache_control: { type: "ephemeral" },
    input_schema: {
      type: "object" as const,
      properties: { codigo: { type: "string", description: "Código del artículo" } },
      required: ["codigo"],
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
  return JSON.stringify({ total: filas.length, resultados: filas });
}

export async function ejecutarHerramienta(uso: UsoHerramienta): Promise<string> {
  try {
    if (uso.name === "buscar_productos") return await buscarProductos(uso.input);
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
    if (uso.name === "precio_referencia_aldo") {
      const codigo = String(uso.input.codigo ?? "").trim();
      if (!/^[A-Za-z0-9._-]{1,50}$/.test(codigo)) {
        return JSON.stringify({ error: "Código inválido" });
      }
      return JSON.stringify(await precioAldo(codigo));
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

  const sistema = promptSistema(new Date().toLocaleDateString("sv-SE"));
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
      resultados.push({
        type: "tool_result",
        tool_use_id: uso.id,
        content: await ejecutarHerramienta(uso),
      });
    }
    mensajes.push({ role: "user", content: resultados });
  }

  return textoFinal;
}
