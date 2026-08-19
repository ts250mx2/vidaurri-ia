import type Anthropic from "@anthropic-ai/sdk";
import { sesionActual } from "@/lib/auth";
import { consultaBdav } from "@/lib/db";
import { consultaUsadas } from "@/lib/db-usadas";
import {
  ejecutarConsultaAgente,
  ejecutarConsultaAgenteUsadas,
  TABLAS_PERMITIDAS,
  TABLAS_PERMITIDAS_USADAS,
} from "@/lib/agente-sql";
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

// Esquema compacto de la base de la BODEGA USADO (sucursal de piezas usadas,
// wwapvi_bd-usadas). Es un sistema aparte de bdav: no comparten IDs ni códigos.
const ESQUEMA_USADAS = `
piezas(id_pieza, id_parte→partes, id_ubicacion→ubicaciones, id_modelo→modelos, codigo, descripcion, lado, posicion, tipo_puerta, anio_inicio, anio_fin, puertas, precio, existencia, motor, numeroparte, origen, fecha_alta, comentarios)  -- inventario de piezas usadas (~19k)
partes(id_parte, parte, cve_parte)  -- tipo de pieza: PUERTA, FARO, CALAVERA, ESPEJO, COMPUTADORA DE MOTOR ECM PCM...
marcas(id_marca, marca)  -- marca del auto
modelos(id_modelo, id_marca→marcas, modelo)
ubicaciones(id_ubicacion, id_modulo→modulos, casillero, estatus)
modulos(id_modulo, modulo)  -- zona física: TERRENO ATRAS, BODEGA PISO 1, PATIO RB...
lados_piezas(id_lado, lado_pieza) / posicion_piezas(id_posicion, posicion) / tipos_puertas(id_tipo, tipo_puerta)
compatibilidades(id_compatibilidad, id_pieza→piezas, id_auto→autos_partes)
autos_partes(id_auto, id_parte→partes, id_modelo→modelos, marca, modelo, lado, posicion, tipo, pines, numeroparte, anio_inicio, anio_fin, precio)  -- catálogo de aplicaciones
ventas(id_venta, num_venta, nombre_cliente, telefono_cliente, fecha, subtotal, iva, total, saldo, estatus 'ACTIVO'|'PAGADO', observa)
venta_detalle(id_vta_detalle, id_venta→ventas, id_pieza→piezas, precio, cantidad, total_item)
bitacora_piezas(id_bitacora, id_pieza→piezas, id_venta, fecha_movimiento, tipo_movimiento 'ENTRADA'|'VENTA'|'DEVOLUCION', folio_movimiento, existencia_anterior, cantidad, existencia_posterior, precio, total)  -- kardex de la sucursal
piezas_imagenes(id, id_pieza→piezas, nombre_imagen, path_imagen, activo) / piezas_ml(id_piezas_ml, id_pieza, pub_ml, tienda) / piezas_ag / piezas_conectores / reglas_compatibilidad / nvos_modelos / proveedores(id_prov, clave_proveedor)
NO uses: usuarios, perfiles, permisos, metodos, control_folios, tmp_*, ni respaldos con fecha (autos_partes_11jul26, piezas_puertas_2jul26, piezas_imagenes_backup...).`;

function promptSistema(nombreUsuario: string, hoy: string): string {
  return `Eres VIDA (Vidaurri Inteligencia de Datos Automotriz), el agente inteligente del sistema de AUTO PARTES VIDAURRI, un negocio mexicano de autopartes de colisión (cofres, defensas, parrillas, polveras...) por marca, modelo y rango de años.
Hoy es ${hoy}. Conversas con ${nombreUsuario}.

Tienes acceso DE SOLO LECTURA a la base de datos MySQL "bdav" mediante la herramienta consulta_sql. Esquema (tabla(columnas, → indica llave foránea)):
${ESQUEMA_BDAV}

La empresa también tiene la BODEGA USADO (sucursal de piezas usadas: puertas, faros, calaveras, espejos, computadoras...), con su PROPIA base de datos, accesible con la herramienta consulta_sql_usadas. Esquema:
${ESQUEMA_USADAS}
Cuando pregunten por piezas usadas, la Bodega Usado, o pidan un panorama de toda la empresa, consulta también esa base. En sus ventas los folios se muestran como U-num_venta (ej. U-645). Sus precios son sin IVA.

Reglas:
- SIEMPRE escribe en español, desde la primera palabra, incluso los comentarios previos a usar herramientas.
- Usa consulta_sql para obtener datos reales; NUNCA inventes cifras ni respondas de memoria. Si una consulta falla, corrige el SQL y reintenta.
- Solo SELECT. El sistema rechaza cualquier otra cosa y recorta a 200 filas: usa agregaciones (SUM, COUNT, GROUP BY) y LIMIT en vez de pedir tablas completas.
- En ventas, los folios se muestran como serie-num_venta (ej. V-53364). serie 'V' = facturación/crédito, 'M' = mostrador. Los años de aplicación aini/afin son enteros (2001, 2006).
- Los importes son pesos mexicanos: formato $#,##0.00. Fechas en español (11/ago/2026).
- PRECIOS AL CLIENTE: los precios del catálogo están guardados SIN IVA. El precio que se cotiza
  es el de MOSTRADOR más IVA: precio_vta * 1.16, el mismo criterio que el Vendedor IA.
  precio_vta ya trae el 33% de descuento que llevan todos los artículos, y es lo que el cliente
  paga. Calcúlalo en el SQL —ROUND(a.precio_vta * 1.16, 2) para bdav, ROUND(p.precio * 1.16, 2)
  para la Bodega Usado— y preséntalo como "con IVA". NUNCA presentes precio_lista, precio_vta ni
  piezas.precio en crudo como si fueran el precio; solo dalos si te los piden, aclarando que son
  sin IVA. precio_lista es el precio de lista antes del descuento: no sirve para cotizar.
- En cambio ventas, cotizaciones y compras YA traen el IVA desglosado (subtotal, iva, total):
  usa la columna total tal cual y NO la multipliques. Las columnas subtotal, precio y
  total_partida del detalle son sin IVA; si las muestras, dilo.
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
    name: "consulta_sql_usadas",
    description:
      "Ejecuta una consulta SELECT de solo lectura en la base de datos de la BODEGA USADO (sucursal de piezas usadas) y devuelve las filas en JSON (máximo 200). Úsala para piezas usadas, sus ventas y su inventario.",
    input_schema: {
      type: "object" as const,
      properties: {
        sql: { type: "string", description: "Consulta SELECT de MySQL (una sola, sin ';')" },
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
      "Devuelve las columnas y tipos exactos de una tabla (SHOW COLUMNS). Úsala si dudas de un nombre de columna.",
    // cache_control en la última herramienta: cachea el prefijo tools+system.
    cache_control: { type: "ephemeral" },
    input_schema: {
      type: "object" as const,
      properties: {
        tabla: { type: "string", description: "Nombre exacto de la tabla" },
        base: {
          type: "string",
          enum: ["bdav", "usadas"],
          description: "Base de datos: 'bdav' (matriz, por defecto) o 'usadas' (sucursal)",
        },
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
  if (uso.name === "consulta_sql_usadas") {
    const sql = String(uso.input.sql ?? "");
    const resultado = await ejecutarConsultaAgenteUsadas(sql);
    return resultado.contenido;
  }
  if (uso.name === "esquema_tabla") {
    const tabla = String(uso.input.tabla ?? "").trim();
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(tabla)) {
      return JSON.stringify({ error: "Nombre de tabla inválido" });
    }
    const esUsadas = uso.input.base === "usadas";
    const permitidas = esUsadas ? TABLAS_PERMITIDAS_USADAS : TABLAS_PERMITIDAS;
    if (!permitidas.has(tabla.toLowerCase())) {
      return JSON.stringify({ error: `La tabla ${tabla} no está disponible para consulta` });
    }
    try {
      const consulta = esUsadas ? consultaUsadas : consultaBdav;
      const columnas = await consulta(`SHOW COLUMNS FROM \`${tabla}\``);
      return JSON.stringify({ tabla, base: esUsadas ? "usadas" : "bdav", columnas });
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
                  : uso.name === "consulta_sql_usadas"
                    ? "Consultando la Bodega Usado"
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
