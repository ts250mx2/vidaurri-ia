// Clientes con descuento del Vendedor IA: tipos y validación de la captura.
// Sin acceso a base de datos: lo comparten las API routes, la capa de datos
// (db-clientes-descuento.ts), la importación de la lista APV y la interfaz.

import { esDescuentoValido } from "./descuento-default";
import { esTelefonoValido, normalizarTelefono } from "./telefono";

export const CLIENTE_MAX = 150;
export const RFC_MAX = 13;
export const TELEFONO2_MAX = 60;
export const EMAIL_MAX = 120;
/** Celulares de WhatsApp por cliente: suficiente para dueño, taller y familia. */
export const TELEFONOS_MAX = 10;

/** Registro del padrón tal como se guarda en BDVidaurriConversaciones. */
export interface ClienteDescuento {
  id: number;
  /** Celular principal: el primero de `telefonos`, o null si no tiene ninguno. */
  telefono: string | null;
  /** Celulares de WhatsApp con los que el Vendedor IA reconoce al cliente: solo
   *  dígitos, nacional de 10 si es de México. Vacío = el cliente existe en el
   *  padrón pero WhatsApp no lo identifica. Un celular pertenece a UN cliente. */
  telefonos: string[];
  cliente: string;
  /** Porcentaje 0-100. */
  descuento: number;
  rfc: string | null;
  /** Otros teléfonos, texto libre tal como viene de la lista ("83226730 - 83549915"). */
  telefono2: string | null;
  email: string | null;
  /** "ID CLIENTE" de la lista de clientes APV de la que se importó. */
  idClienteApv: number | null;
  /** clientes.id en bdav si el registro se prellenó del catálogo o se ligó por RFC. */
  idClienteBdav: number | null;
  /** El cliente puede levantar pedidos. */
  permitirPedido: boolean;
  creadoPor: string | null;
  /** Fecha de alta 'AAAA-MM-DD HH:MM:SS' (America/Monterrey). */
  creadoEn: string;
  actualizadoPor: string | null;
  actualizadoEn: string;
}

/** Lo que se captura en el formulario (alta y edición), ya normalizado. */
export interface CapturaClienteDescuento {
  telefonos: string[];
  cliente: string;
  descuento: number;
  rfc: string | null;
  telefono2: string | null;
  email: string | null;
  idClienteApv: number | null;
  idClienteBdav: number | null;
  permitirPedido: boolean;
}

export type ResultadoValidacion =
  | { ok: true; datos: CapturaClienteDescuento }
  | { ok: false; error: string };

/** Los comodines de LIKE que teclee el usuario se buscan literales. */
function escaparLike(texto: string): string {
  return texto.replace(/[\\%_]/g, "\\$&");
}

/** Solo dígitos y separadores típicos de un teléfono ('81 1234-5678', '+52…'). */
const PARECE_TELEFONO = /^[\d\s\-+().]+$/;

export interface CondicionesBusqueda {
  /** Fragmento WHERE (sin la palabra WHERE) con placeholders ?. El padrón va
   *  con el alias `c`; los celulares se buscan en clientes_descuento_telefonos. */
  clausula: string;
  parametros: string[];
}

const TIENE_CELULAR_QUE =
  "EXISTS (SELECT 1 FROM clientes_descuento_telefonos t WHERE t.id_cliente = c.id AND t.telefono LIKE ?)";

/**
 * Búsqueda del padrón: cuando lo tecleado parece un número se busca en los
 * celulares y en los otros teléfonos (y en el nombre); en cualquier otro caso
 * por nombre, RFC o email, para que un dígito suelto dentro de un nombre
 * ('Taller 3 Hermanos') no empate medio padrón. El número se normaliza igual
 * que al guardar: '5218112345678' encuentra a 8112345678.
 */
export function condicionesBusqueda(busqueda: string): CondicionesBusqueda {
  const texto = busqueda.trim();
  if (!texto) return { clausula: "1 = 1", parametros: [] };
  const porTexto = `%${escaparLike(texto)}%`;
  const digitos = normalizarTelefono(texto);
  if (PARECE_TELEFONO.test(texto) && digitos) {
    return {
      clausula: `(c.cliente LIKE ? OR c.telefono2 LIKE ? OR ${TIENE_CELULAR_QUE})`,
      parametros: [porTexto, `%${digitos}%`, `%${digitos}%`],
    };
  }
  return {
    clausula: "(c.cliente LIKE ? OR c.rfc LIKE ? OR c.email LIKE ?)",
    parametros: [porTexto, porTexto, porTexto],
  };
}

export type FiltroCelular = "con" | "sin";

/** Filtro "con celular / sin celular" del padrón; sin filtro no restringe. */
export function condicionCelular(filtro: FiltroCelular | undefined): string {
  const tiene = "EXISTS (SELECT 1 FROM clientes_descuento_telefonos t WHERE t.id_cliente = c.id)";
  if (filtro === "con") return tiene;
  if (filtro === "sin") return `NOT ${tiene}`;
  return "1 = 1";
}

function leerDescuento(crudo: unknown): number {
  if (typeof crudo === "number") return crudo;
  if (typeof crudo !== "string") return Number.NaN;
  const limpio = crudo.trim().replace(/%$/, "").trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(limpio)) return Number.NaN;
  return Number(limpio);
}

/** null = sin referencia; undefined = valor inválido. Solo enteros seguros
 *  escritos en decimal (nada de 1e20, 0x1F ni valores que BIGINT no acepte). */
function leerReferencia(crudo: unknown): number | null | undefined {
  if (crudo == null || crudo === "") return null;
  if (typeof crudo === "string" && !/^\d{1,15}$/.test(crudo.trim())) return undefined;
  const numero = typeof crudo === "number" ? crudo : Number(String(crudo).trim());
  if (!Number.isSafeInteger(numero) || numero <= 0) return undefined;
  return numero;
}

/** Quita caracteres de control y de formato invisibles (bidi, ancho cero, BOM)
 *  que no pertenecen a un texto capturado y podrían disfrazar lo que se ve en
 *  pantalla; colapsa los espacios. */
export function limpiarTexto(crudo: string): string {
  return crudo
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** RFC en mayúsculas y sin separadores ('ABC 850101-XY1' -> 'ABC850101XY1'). */
export function normalizarRfc(crudo: string): string {
  return limpiarTexto(crudo).toUpperCase().replace(/[\s-]/g, "");
}

/** 12 caracteres (persona moral) o 13 (física): letras, dígitos, Ñ y &. */
const RFC_VALIDO = /^[A-ZÑ&0-9]{12,13}$/;

type LecturaTelefonos = { ok: true; telefonos: string[] } | { ok: false; error: string };

/**
 * Celulares del cuerpo: `telefonos` (lista) y, por compatibilidad, `telefono`
 * (uno solo), que va primero. Son opcionales (la lista APV trae miles de
 * clientes sin celular), pero cada uno que venga tiene que estar completo:
 * con menos dígitos no identifica a nadie. Repetidos y vacíos se descartan.
 */
function leerTelefonos(cuerpo: Record<string, unknown>): LecturaTelefonos {
  const crudos: unknown[] = Array.isArray(cuerpo.telefonos) ? [...cuerpo.telefonos] : [];
  if (cuerpo.telefono != null && cuerpo.telefono !== "") crudos.unshift(cuerpo.telefono);

  const telefonos: string[] = [];
  for (const crudo of crudos) {
    const texto = typeof crudo === "string" ? crudo : String(crudo ?? "");
    const normalizado = normalizarTelefono(texto);
    if (!normalizado && !texto.trim()) continue;
    if (!esTelefonoValido(normalizado)) {
      return { ok: false, error: `El celular "${texto.trim()}" debe tener 10 dígitos` };
    }
    if (!telefonos.includes(normalizado)) telefonos.push(normalizado);
  }
  if (telefonos.length > TELEFONOS_MAX) {
    return { ok: false, error: `Un cliente no puede tener más de ${TELEFONOS_MAX} celulares` };
  }
  return { ok: true, telefonos };
}

/** Valida y normaliza el cuerpo que manda el formulario; mensajes para el usuario. */
export function validarCapturaClienteDescuento(entrada: unknown): ResultadoValidacion {
  if (!entrada || typeof entrada !== "object" || Array.isArray(entrada)) {
    return { ok: false, error: "Petición inválida" };
  }
  const cuerpo = entrada as Record<string, unknown>;

  const lectura = leerTelefonos(cuerpo);
  if (!lectura.ok) return lectura;

  const cliente = limpiarTexto(String(cuerpo.cliente ?? ""));
  if (!cliente) return { ok: false, error: "Captura el nombre del cliente" };
  if (cliente.length > CLIENTE_MAX) {
    return { ok: false, error: `El nombre no puede pasar de ${CLIENTE_MAX} caracteres` };
  }

  const descuento = leerDescuento(cuerpo.descuento);
  if (!esDescuentoValido(descuento)) {
    return { ok: false, error: "El descuento debe ser un número entre 0 y 100" };
  }

  const rfc = normalizarRfc(String(cuerpo.rfc ?? ""));
  if (rfc && !RFC_VALIDO.test(rfc)) {
    return { ok: false, error: "El RFC debe tener 12 o 13 caracteres" };
  }

  const telefono2 = limpiarTexto(String(cuerpo.telefono2 ?? ""));
  if (telefono2.length > TELEFONO2_MAX) {
    return { ok: false, error: `Los otros teléfonos no pueden pasar de ${TELEFONO2_MAX} caracteres` };
  }

  // El email se guarda como dato de contacto, sin exigirle formato: la lista
  // real trae "ROSSY_9@LIVE" y "PEPE@GMAIL,COM", y rechazarlos solo dejaría
  // al cliente sin email en vez de con el que el negocio tiene.
  const email = limpiarTexto(String(cuerpo.email ?? ""));
  if (email.length > EMAIL_MAX) {
    return { ok: false, error: `El email no puede pasar de ${EMAIL_MAX} caracteres` };
  }

  const idClienteApv = leerReferencia(cuerpo.idClienteApv);
  if (idClienteApv === undefined) {
    return { ok: false, error: "ID de cliente APV inválido" };
  }
  const idClienteBdav = leerReferencia(cuerpo.idClienteBdav);
  if (idClienteBdav === undefined) {
    return { ok: false, error: "Referencia de cliente inválida" };
  }

  return {
    ok: true,
    datos: {
      telefonos: lectura.telefonos,
      cliente,
      descuento: Math.round(descuento * 100) / 100,
      rfc: rfc || null,
      telefono2: telefono2 || null,
      email: email || null,
      idClienteApv,
      idClienteBdav,
      permitirPedido: cuerpo.permitirPedido === true,
    },
  };
}

/** El cuerpo de "permitir pedido": solo un booleano explícito vale. */
export function leerPermitirPedido(entrada: unknown): boolean | null {
  if (!entrada || typeof entrada !== "object" || Array.isArray(entrada)) return null;
  const valor = (entrada as Record<string, unknown>).permitirPedido;
  return typeof valor === "boolean" ? valor : null;
}

/** El [id] de la ruta /api/clientes-descuento/[id]: entero positivo escrito
 *  tal cual ('12'; no '012', '1e1' ni '12abc'). null si no lo es. */
export function leerIdRuta(id: string): number | null {
  const numero = Number.parseInt(id, 10);
  return Number.isInteger(numero) && numero > 0 && String(numero) === id ? numero : null;
}
