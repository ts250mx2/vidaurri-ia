import type Anthropic from "@anthropic-ai/sdk";
import { sesionActual } from "@/lib/auth";
import { consultaBdav } from "@/lib/db";
import { ejecutarConsultaAgente, TABLAS_PERMITIDAS } from "@/lib/agente-sql";
import { correrTurnoAgente, claveFaltante, type UsoHerramienta } from "@/lib/agente-modelo";
import { esModeloVidaValido } from "@/lib/modelos-vida";

// Agente VIDA — Vidaurri Inteligencia de Datos Automotriz.
// Protocolo de streaming NDJSON (patrón kyk-server-web):
//   {t:'delta', texto}  — fragmento de la respuesta en curso
//   {t:'reinicio'}      — descartar el borrador: viene una ronda de herramientas
//   {t:'estado', texto} — qué está consultando el agente
//   {t:'fin'}           — respuesta completa
//   {t:'error', error}  — falla a media respuesta

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_ITERACIONES = 6;
const MAX_HISTORIAL = 12;
const MAX_PREGUNTA = 2000;
const MAX_TOKENS = 4000;

// Rate limit en memoria: 10 preguntas por minuto por usuario.
const ventanas = new Map<string, number[]>();
function excedeLimite(clave: string): boolean {
  const ahora = Date.now();
  const ventana = (ventanas.get(clave) ?? []).filter((t) => ahora - t < 60_000);
  if (ventana.length >= 10) return true;
  ventana.push(ahora);
  ventanas.set(clave, ventana);
  return false;
}

// Esquema compacto de las tablas vivas de bdav para el prompt del sistema.
const ESQUEMA_BDAV = `
articulos(id, id_prov→proveedores, id_linea→lineas, id_parte→partes, codigo, descripcion, precio_lista, precio_cpa, descuento, precio_vta, utilidad, existencia, minimo, maximo, reorden, localizacion, aini, afin)
lineas(id, linea)  -- marca del auto: ACURA, BMW, CHEVROLET, FORD, NISSAN...
partes(id, parte)  -- tipo de pieza: COFRES, POLVERAS, PARRILLAS, DEFENSAS...
modelos(id, id_linea→lineas, modelo)
\`art-mod\`(id, id_articulo→articulos, id_modelo→modelos, aini, afin)  -- aplicaciones por modelo (backticks obligatorios)
codigos_alternos(id, id_articulo→articulos, codigo, codigo_alterno)
partes_usadas(id, id_parte, id_linea, codigo, modelo, aini, afin, descripcion, precio_vta, existencia)  -- piezas usadas
proveedores(id, nombre, ciudad, telefono, saldo)
ventas(id, id_cliente→clientes, num_venta, serie 'V'|'M', fecha, subtotal, iva, total, saldo, estatus 'VIGENTE'|'PAGADA', num_cotiza, nombre, telefono, observa)
detalle_venta(id, id_venta→ventas, id_articulo→articulos, partida, cantidad, precio, total_partida)  -- las columnas devolucion/num_devol existen pero el POS NO las llena: no las uses
venta_formapago(id, id_venta→ventas, id_formapago→forma_pago, id_usuario→usuarios)
forma_pago(id, cve_pago, describe_pago)  -- EFECTIVO, TARJETA, CREDITO, CHEQUE, TRANSFERENCIA
cotiza(id, id_cte→clientes NULL, num_cotiza, nombre, telefono, fecha_cot, subtotal, iva, total, observa, estatus 'VIGENTE'|'VENTA'|'CANCELADA')
detalle_cotiza(id, id_cot→cotiza, id_articulo→articulos, partida, cantidad, precio, total_partida)
clientes(id, rfc, nombre, calle, numero, colonia, ciudad, estado, telefono, descuento, saldo, activo bit, email, limite_credito, bloqueo_por_adeudo bit)
pagos_ventas(id_pago, id_cliente, num_pago, fecha_pago, forma_pago, num_referencia, total_pago, estatus_pago)
pagos_detalle(id_pagos_detalle, id_pago_fk→pagos_ventas, id_venta, num_venta, total_venta)
pedidos(id, id_prov→proveedores, num_pedido, fecha, subtotal, iva, total, estatus 'ABIERTO'|'COMPLETO'|'INCOMPLETO')
detalle_pedido(id, id_pedido→pedidos, id_articulo→articulos, partida, codigo, cantidad, total_partida, cant_recibida, cant_pdte)
compras(id, id_prov→proveedores, id_pedido→pedidos, num_compra, fecha_compra, subtotal, iva, total)
detalle_compra(id, id_compra→compras, id_articulo→articulos, partida, cantidad, total_part)
facturas_compras(id, id_compra→compras, num_factura, fecha_factura, subtotal, iva, total, saldo, estatus)
detalle_factura_compra(id, id_fact_compra→facturas_compras, id_articulo→articulos, partida, cantidad, precio_compra, total_part)
devoluciones(id, num_devolucion, fecha_devolucion, subtotal, iva, total, estatus_devolucion)
devoluciones_detalle(id, id_devolucion→devoluciones, id_articulo→articulos, partida, cantidad, precio, total_partida, causa_devolucion)
mov_articulos(id, id_articulo→articulos, fecha, tipo_mov 'ENTRADA'|'VENTA'|'DEVOLUCION', num_doc, tipo_doc, exist_ant, cantidad, exist_post)  -- kardex, 610k filas: filtra SIEMPRE por fecha o id_articulo. Los id_venta/id_compra existen pero suelen venir NULL: usa num_doc/tipo_doc
back_order(id, id_prov, id_cte→clientes, id_vendedor→vendedores, num_bko, fecha_bko, nombre_cliente, subtotal, iva, total, anticipo, liquida, saldo, estatus 'ABIERTA'|'PROCESO'|'RECIBIDA'|'VENTA', fecha_compromiso)
detalle_bko(id, id_bko→back_order, id_art→articulos, partida, cantidad, precio, total_part, estatus, cant_recibida, fecha_llegada)
backorder_venta(id, id_bko→back_order, id_vta→ventas)
vendedores(id, vendedor)
generales(id, rfc, empresa, ...)  -- datos de la empresa
NO uses: articulos_21mzo26, clientes_21mzo26, generales_23mzo26, bk_arts*, articulos_eliminados, pedido_tony, banderas, tbl_*, tmp*, vistas vw_* (legacy/respaldos). La tabla de usuarios/claves NO está disponible.`;

function promptSistema(nombreUsuario: string, hoy: string): string {
  return `Eres VIDA (Vidaurri Inteligencia de Datos Automotriz), el agente inteligente del sistema de AUTO PARTES VIDAURRI, un negocio mexicano de autopartes de colisión (cofres, defensas, parrillas, polveras...) por marca, modelo y rango de años.
Hoy es ${hoy}. Conversas con ${nombreUsuario}.

Tienes acceso DE SOLO LECTURA a la base de datos MySQL "bdav" mediante la herramienta consulta_sql. Esquema (tabla(columnas, → indica llave foránea)):
${ESQUEMA_BDAV}

Reglas:
- SIEMPRE escribe en español, desde la primera palabra, incluso los comentarios previos a usar herramientas.
- Usa consulta_sql para obtener datos reales; NUNCA inventes cifras ni respondas de memoria. Si una consulta falla, corrige el SQL y reintenta.
- Solo SELECT. El sistema rechaza cualquier otra cosa y recorta a 200 filas: usa agregaciones (SUM, COUNT, GROUP BY) y LIMIT en vez de pedir tablas completas.
- En ventas, los folios se muestran como serie-num_venta (ej. V-53364). serie 'V' = facturación/crédito, 'M' = mostrador. Los años de aplicación aini/afin son enteros (2001, 2006).
- Los importes son pesos mexicanos: formato $#,##0.00. Fechas en español (11/ago/2026).
- Responde en español, breve y directo, con tablas markdown cuando ayuden. En listas muestra máximo 10 renglones y ofrece afinar la búsqueda.
- Si te preguntan algo ajeno a los datos del negocio (temas generales, opiniones, otras empresas), responde amablemente que solo puedes ayudar con la información de Auto Partes Vidaurri.
- Cuando el usuario pida "hoy", "este mes", etc., usa la fecha actual (${hoy}) en el SQL con CURDATE()/DATE_FORMAT.`;
}

const HERRAMIENTAS: Anthropic.Tool[] = [
  {
    name: "consulta_sql",
    description:
      "Ejecuta una consulta SELECT de solo lectura en la base de datos bdav y devuelve las filas en JSON (máximo 200). Úsala para cualquier dato del negocio.",
    input_schema: {
      type: "object" as const,
      properties: {
        sql: { type: "string", description: "Consulta SELECT de MySQL 8 (una sola, sin ';')" },
        proposito: {
          type: "string",
          description: "Qué estás consultando, en 3-6 palabras en español (se muestra al usuario)",
        },
      },
      required: ["sql"],
    },
  },
  {
    name: "esquema_tabla",
    description:
      "Devuelve las columnas y tipos exactos de una tabla de bdav (SHOW COLUMNS). Úsala si dudas de un nombre de columna.",
    // cache_control en la última herramienta: cachea el prefijo tools+system.
    cache_control: { type: "ephemeral" },
    input_schema: {
      type: "object" as const,
      properties: {
        tabla: { type: "string", description: "Nombre exacto de la tabla" },
      },
      required: ["tabla"],
    },
  },
];

async function ejecutarHerramienta(uso: UsoHerramienta): Promise<string> {
  if (uso.name === "consulta_sql") {
    const sql = String(uso.input.sql ?? "");
    const resultado = await ejecutarConsultaAgente(sql);
    return resultado.contenido;
  }
  if (uso.name === "esquema_tabla") {
    const tabla = String(uso.input.tabla ?? "").trim();
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(tabla)) {
      return JSON.stringify({ error: "Nombre de tabla inválido" });
    }
    if (!TABLAS_PERMITIDAS.has(tabla.toLowerCase())) {
      return JSON.stringify({ error: `La tabla ${tabla} no está disponible para consulta` });
    }
    try {
      const columnas = await consultaBdav(`SHOW COLUMNS FROM \`${tabla}\``);
      return JSON.stringify({ tabla, columnas });
    } catch {
      return JSON.stringify({ error: `No existe la tabla ${tabla}` });
    }
  }
  return JSON.stringify({ error: "Herramienta desconocida" });
}

interface MensajeCliente {
  rol: "usuario" | "agente";
  texto: string;
}

export async function POST(request: Request) {
  const sesion = await sesionActual();
  if (!sesion) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }
  if (excedeLimite(`${sesion.id}:${sesion.usuario}`)) {
    return Response.json(
      { error: "Demasiadas preguntas seguidas; espera un momento" },
      { status: 429 }
    );
  }

  let cuerpo: { pregunta?: string; historial?: MensajeCliente[]; modelo?: string };
  try {
    cuerpo = await request.json();
  } catch {
    return Response.json({ error: "Petición inválida" }, { status: 400 });
  }
  const pregunta = String(cuerpo.pregunta ?? "").trim().slice(0, MAX_PREGUNTA);
  if (!pregunta) return Response.json({ error: "Escribe una pregunta" }, { status: 400 });

  // El usuario elige el modelo desde la interfaz (lista blanca); si no llega uno
  // válido, se usa el del entorno.
  const modeloElegido = String(cuerpo.modelo ?? "");
  const modelo = esModeloVidaValido(modeloElegido)
    ? modeloElegido
    : process.env.AGENTES_MODELO || "claude-opus-5";
  const claveEnv = claveFaltante(modelo);
  if (claveEnv) {
    return Response.json(
      { error: `Falta configurar ${claveEnv} en el servidor para el modelo seleccionado` },
      { status: 500 }
    );
  }

  // Historial reciente (texto plano) → mensajes del modelo.
  const historial = (cuerpo.historial ?? []).slice(-MAX_HISTORIAL);
  const mensajes: Anthropic.MessageParam[] = historial.map((m) => ({
    role: m.rol === "usuario" ? "user" : "assistant",
    content: m.texto.slice(0, 4000),
  }));
  mensajes.push({ role: "user", content: pregunta });

  const hoy = new Date().toLocaleDateString("sv-SE");
  const sistema = promptSistema(sesion.nombre, hoy);
  const codificador = new TextEncoder();

  const stream = new ReadableStream({
    async start(controlador) {
      let viva = true;
      const emitir = (evento: Record<string, unknown>) => {
        if (!viva) return;
        try {
          controlador.enqueue(codificador.encode(JSON.stringify(evento) + "\n"));
        } catch {
          viva = false; // el cliente cerró la conexión
        }
      };

      try {
        for (let ronda = 0; ronda < MAX_ITERACIONES; ronda++) {
          const ultimaRonda = ronda === MAX_ITERACIONES - 1;
          const resultado = await correrTurnoAgente({
            modelo,
            sistema,
            herramientas: HERRAMIENTAS,
            mensajes,
            maxTokens: MAX_TOKENS,
            sinHerramientas: ultimaRonda,
            alTexto: (texto) => emitir({ t: "delta", texto }),
          });

          if (resultado.usos.length === 0) break; // respuesta final ya streameada

          // Ronda de herramientas: descartar el preámbulo ya enviado.
          emitir({ t: "reinicio" });
          mensajes.push({ role: "assistant", content: resultado.contenido });

          const resultadosHerramientas: Anthropic.ToolResultBlockParam[] = [];
          for (const uso of resultado.usos) {
            const proposito =
              typeof uso.input.proposito === "string" && uso.input.proposito
                ? uso.input.proposito
                : uso.name === "esquema_tabla"
                  ? `Revisando la tabla ${uso.input.tabla ?? ""}`
                  : "Consultando la base de datos";
            emitir({ t: "estado", texto: proposito });
            const contenido = await ejecutarHerramienta(uso);
            resultadosHerramientas.push({
              type: "tool_result",
              tool_use_id: uso.id,
              content: contenido,
            });
          }
          mensajes.push({ role: "user", content: resultadosHerramientas });
        }
        emitir({ t: "fin" });
      } catch (error) {
        console.error("Error en agente VIDA:", error);
        emitir({
          t: "error",
          error: "VIDA tuvo un problema al responder; intenta de nuevo",
        });
      } finally {
        try {
          controlador.close();
        } catch {
          // ya cerrado por el cliente
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
