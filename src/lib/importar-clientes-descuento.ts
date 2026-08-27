// Lectura de la lista de clientes APV (CSV exportado de Excel) para cargarla
// al padrón de clientes con descuento. Sin acceso a base de datos: aquí solo
// se interpreta el archivo y se deja cada fila validada y normalizada con las
// MISMAS reglas que la captura a mano (validarCapturaClienteDescuento), de
// modo que lo importado y lo tecleado no puedan tener formas distintas.
//
// La lista real trae de todo: 2,768 clientes sin celular, 139 con un fijo de
// 8 dígitos en la columna del celular, RFCs en minúsculas, emails con coma en
// vez de punto, nombres entre comillas. La regla es no perder información:
// lo que no cabe donde va, se conserva donde sí (un fijo en la columna del
// celular pasa a "otros teléfonos") y se reporta; se omite una fila solo
// cuando de verdad no se puede guardar (sin nombre, sin ID, ID repetido).

import {
  EMAIL_MAX,
  TELEFONO2_MAX,
  limpiarTexto,
  normalizarRfc,
  validarCapturaClienteDescuento,
  type CapturaClienteDescuento,
} from "./clientes-descuento";
import { normalizarTelefono } from "./telefono";

/** Fila lista para el padrón, con el ID de la lista y su línea en el archivo. */
export interface FilaImportacion extends CapturaClienteDescuento {
  idClienteApv: number;
  linea: number;
}

export interface IncidenciaImportacion {
  linea: number;
  motivo: string;
}

export interface LecturaLista {
  filas: FilaImportacion[];
  /** Filas que no entran al padrón, con el porqué. */
  omitidas: IncidenciaImportacion[];
  /** Filas que sí entran pero con algún dato movido o descartado. */
  advertencias: IncidenciaImportacion[];
}

/** Excel en Windows exporta en Windows-1252 ("Teléfono" con un solo byte para
 *  la é); otras herramientas en UTF-8. Se intenta UTF-8 estricto y, si el
 *  archivo no es UTF-8 válido, se lee como 1252. */
export function decodificarCsv(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/** CSV con comillas dobles (y comillas escapadas duplicándolas), finales CRLF o LF. */
export function parsearCsv(texto: string): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = "";
  let entreComillas = false;

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (entreComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          campo += '"';
          i++;
        } else {
          entreComillas = false;
        }
      } else {
        campo += c;
      }
    } else if (c === '"') {
      entreComillas = true;
    } else if (c === ",") {
      fila.push(campo);
      campo = "";
    } else if (c === "\n") {
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = "";
    } else if (c !== "\r") {
      campo += c;
    }
  }
  if (campo !== "" || fila.length > 0) {
    fila.push(campo);
    filas.push(fila);
  }
  return filas;
}

/** "Teléfono 1" -> "telefono 1": sin acentos, minúsculas, solo letras y números. */
function normalizarEncabezado(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

type Campo = "idClienteApv" | "rfc" | "nombre" | "telefono1" | "telefono2" | "email" | "descuento";

/** Nombres con los que puede venir cada columna, ya normalizados. */
const ENCABEZADOS: Record<Campo, string[]> = {
  idClienteApv: ["id cliente", "id", "clave"],
  rfc: ["rfc"],
  nombre: ["nombre", "cliente", "razon social"],
  telefono1: ["telefono 1", "telefono1", "telefono", "celular"],
  telefono2: ["telefono2", "telefono 2", "otros telefonos"],
  email: ["email", "correo", "e mail"],
  descuento: ["descuento", "desc"],
};
const OBLIGATORIOS: Campo[] = ["idClienteApv", "nombre", "descuento"];
const ETIQUETA: Record<Campo, string> = {
  idClienteApv: "ID CLIENTE",
  rfc: "RFC",
  nombre: "Nombre",
  telefono1: "Teléfono 1",
  telefono2: "telefono2",
  email: "Email",
  descuento: "DESCUENTO",
};

function ubicarColumnas(encabezado: string[]): Partial<Record<Campo, number>> {
  const normalizados = encabezado.map(normalizarEncabezado);
  const columnas: Partial<Record<Campo, number>> = {};
  for (const campo of Object.keys(ENCABEZADOS) as Campo[]) {
    const indice = normalizados.findIndex((n) => ENCABEZADOS[campo].includes(n));
    if (indice >= 0) columnas[campo] = indice;
  }
  for (const campo of OBLIGATORIOS) {
    if (columnas[campo] === undefined) {
      throw new Error(`El archivo no trae la columna "${ETIQUETA[campo]}"`);
    }
  }
  return columnas;
}

const ID_APV_VALIDO = /^\d{1,9}$/;
const CELULAR_MX = /^\d{10}$/;
const RFC_VALIDO = /^[A-ZÑ&0-9]{12,13}$/;

/**
 * Interpreta el CSV completo. Lanza si falta una columna obligatoria o el
 * archivo está vacío; cualquier otro problema queda por fila en `omitidas` o
 * `advertencias`, nunca detiene la lista entera.
 */
export function leerListaApv(texto: string): LecturaLista {
  const filas = parsearCsv(texto).filter((f) => f.some((celda) => celda.trim() !== ""));
  if (filas.length === 0) throw new Error("El archivo está vacío");
  const columnas = ubicarColumnas(filas[0]);
  const celda = (fila: string[], campo: Campo): string => {
    const indice = columnas[campo];
    return indice === undefined ? "" : (fila[indice] ?? "").trim();
  };

  const lista: FilaImportacion[] = [];
  const omitidas: IncidenciaImportacion[] = [];
  const advertencias: IncidenciaImportacion[] = [];
  /** ID CLIENTE -> línea donde apareció primero. */
  const vistos = new Map<number, number>();

  for (let i = 1; i < filas.length; i++) {
    const fila = filas[i];
    const linea = i + 1;

    const idTexto = celda(fila, "idClienteApv");
    if (!ID_APV_VALIDO.test(idTexto) || Number(idTexto) === 0) {
      omitidas.push({ linea, motivo: `ID CLIENTE inválido ("${idTexto}")` });
      continue;
    }
    const idClienteApv = Number(idTexto);
    const primera = vistos.get(idClienteApv);
    if (primera !== undefined) {
      omitidas.push({
        linea,
        motivo: `ID CLIENTE ${idClienteApv} repetido: ya venía en la línea ${primera}`,
      });
      continue;
    }

    // El celular es la llave de WhatsApp: solo un nacional de 10 dígitos sirve.
    // Un fijo de 8, un número de 11 o algo raro en esa columna no se tira: pasa
    // a "otros teléfonos" para que el negocio no lo pierda.
    let telefono: string | null = null;
    let otrosTelefonos = celda(fila, "telefono2");
    const telefono1 = celda(fila, "telefono1");
    if (telefono1) {
      const nacional = normalizarTelefono(telefono1);
      if (CELULAR_MX.test(nacional)) {
        telefono = nacional;
      } else {
        otrosTelefonos = otrosTelefonos ? `${telefono1} / ${otrosTelefonos}` : telefono1;
        advertencias.push({
          linea,
          motivo: `"${telefono1}" no es un celular de 10 dígitos: se guardó en otros teléfonos`,
        });
      }
    }

    let rfc = normalizarRfc(celda(fila, "rfc"));
    if (rfc && !RFC_VALIDO.test(rfc)) {
      advertencias.push({ linea, motivo: `RFC "${rfc}" inválido: no se guardó` });
      rfc = "";
    }

    const resultado = validarCapturaClienteDescuento({
      telefono,
      cliente: celda(fila, "nombre"),
      descuento: celda(fila, "descuento"),
      rfc,
      telefono2: limpiarTexto(otrosTelefonos).slice(0, TELEFONO2_MAX),
      email: limpiarTexto(celda(fila, "email")).slice(0, EMAIL_MAX),
      idClienteApv,
      idClienteBdav: null,
    });
    if (!resultado.ok) {
      omitidas.push({ linea, motivo: resultado.error });
      continue;
    }

    vistos.set(idClienteApv, linea);
    lista.push({ ...resultado.datos, idClienteApv, linea });
  }

  return { filas: lista, omitidas, advertencias };
}
