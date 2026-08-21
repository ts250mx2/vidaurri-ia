// Clientes con descuento del Vendedor IA: tipos y validación de la captura.
// Sin acceso a base de datos: lo comparten las API routes, la capa de datos
// (db-clientes-descuento.ts) y la interfaz.

import { esDescuentoValido } from "./descuento-default";
import { esTelefonoValido, normalizarTelefono } from "./telefono";

export const CLIENTE_MAX = 150;

/** Registro del padrón tal como se guarda en BDVidaurriConversaciones. */
export interface ClienteDescuento {
  id: number;
  /** Solo dígitos; nacional de 10 si es de México. */
  telefono: string;
  cliente: string;
  /** Porcentaje 0-100. */
  descuento: number;
  /** clientes.id en bdav si el registro se prellenó del catálogo. */
  idClienteBdav: number | null;
  creadoPor: string | null;
  /** Fecha de alta 'AAAA-MM-DD HH:MM:SS' (America/Monterrey). */
  creadoEn: string;
  actualizadoPor: string | null;
  actualizadoEn: string;
}

/** Lo que se captura en el formulario (alta y edición), ya normalizado. */
export interface CapturaClienteDescuento {
  telefono: string;
  cliente: string;
  descuento: number;
  idClienteBdav: number | null;
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
  /** Fragmento WHERE (sin la palabra WHERE) con placeholders ?. */
  clausula: string;
  parametros: string[];
}

/**
 * Búsqueda del padrón: por teléfono (y nombre) cuando lo tecleado parece un
 * número; solo por nombre en cualquier otro caso, para que un dígito suelto
 * dentro de un nombre ('Taller 3 Hermanos') no empate medio padrón. El número
 * se normaliza igual que al guardar: '5218112345678' encuentra a 8112345678.
 */
export function condicionesBusqueda(busqueda: string): CondicionesBusqueda {
  const texto = busqueda.trim();
  if (!texto) return { clausula: "1 = 1", parametros: [] };
  const porNombre = `%${escaparLike(texto)}%`;
  const digitos = normalizarTelefono(texto);
  if (PARECE_TELEFONO.test(texto) && digitos) {
    return {
      clausula: "(cliente LIKE ? OR telefono LIKE ?)",
      parametros: [porNombre, `%${digitos}%`],
    };
  }
  return { clausula: "cliente LIKE ?", parametros: [porNombre] };
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
function leerIdClienteBdav(crudo: unknown): number | null | undefined {
  if (crudo == null || crudo === "") return null;
  if (typeof crudo === "string" && !/^\d{1,15}$/.test(crudo.trim())) return undefined;
  const numero = typeof crudo === "number" ? crudo : Number(String(crudo).trim());
  if (!Number.isSafeInteger(numero) || numero <= 0) return undefined;
  return numero;
}

/** Quita caracteres de control y de formato invisibles (bidi, ancho cero, BOM)
 *  que no pertenecen a un nombre y podrían disfrazar lo que se ve en pantalla. */
function limpiarNombre(crudo: string): string {
  return crudo
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Valida y normaliza el cuerpo que manda el formulario; mensajes para el usuario. */
export function validarCapturaClienteDescuento(entrada: unknown): ResultadoValidacion {
  if (!entrada || typeof entrada !== "object" || Array.isArray(entrada)) {
    return { ok: false, error: "Petición inválida" };
  }
  const cuerpo = entrada as Record<string, unknown>;

  const telefono = normalizarTelefono(String(cuerpo.telefono ?? ""));
  if (!esTelefonoValido(telefono)) {
    return { ok: false, error: "El teléfono debe tener 10 dígitos" };
  }

  const cliente = limpiarNombre(String(cuerpo.cliente ?? ""));
  if (!cliente) return { ok: false, error: "Captura el nombre del cliente" };
  if (cliente.length > CLIENTE_MAX) {
    return { ok: false, error: `El nombre no puede pasar de ${CLIENTE_MAX} caracteres` };
  }

  const descuento = leerDescuento(cuerpo.descuento);
  if (!esDescuentoValido(descuento)) {
    return { ok: false, error: "El descuento debe ser un número entre 0 y 100" };
  }

  const idClienteBdav = leerIdClienteBdav(cuerpo.idClienteBdav);
  if (idClienteBdav === undefined) {
    return { ok: false, error: "Referencia de cliente inválida" };
  }

  return {
    ok: true,
    datos: {
      telefono,
      cliente,
      descuento: Math.round(descuento * 100) / 100,
      idClienteBdav,
    },
  };
}
