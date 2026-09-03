// Markdown de las respuestas de los agentes → bloques planos para el PDF.
// Usa el mismo parser que la pantalla (remark + GFM), así lo que se ve es lo
// que se imprime: encabezados, párrafos con negritas, listas anidadas (con
// casillas de tareas), tablas, bloques de código, citas, líneas y notas al
// pie. Sin nada de jsPDF: es lógica pura.

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { toString as textoDeNodo } from "mdast-util-to-string";
import type { FootnoteDefinition, List, PhrasingContent, Root, RootContent, Table } from "mdast";

export interface Run {
  texto: string;
  negrita: boolean;
  cursiva: boolean;
  codigo: boolean;
}

export type Alineacion = "left" | "center" | "right";

export interface ItemLista {
  bloques: Bloque[];
  /** Casilla de una lista de tareas ('- [x]'); null si es un item normal. */
  marcado: boolean | null;
}

export type Bloque =
  | { tipo: "encabezado"; nivel: number; runs: Run[] }
  | { tipo: "parrafo"; runs: Run[] }
  | { tipo: "lista"; ordenada: boolean; inicio: number; items: ItemLista[] }
  | { tipo: "tabla"; encabezado: string[]; filas: string[][]; alineacion: Alineacion[] }
  | { tipo: "codigo"; texto: string }
  | { tipo: "cita"; bloques: Bloque[] }
  | { tipo: "linea" };

type Estilo = Omit<Run, "texto">;

const SIN_ESTILO: Estilo = { negrita: false, cursiva: false, codigo: false };

/** Texto con formato en línea (negritas, cursivas, código); enlaces e imágenes quedan como su texto. */
function runsDe(nodos: PhrasingContent[], estilo: Estilo = SIN_ESTILO): Run[] {
  const runs: Run[] = [];
  for (const nodo of nodos) {
    switch (nodo.type) {
      case "text":
        runs.push({ texto: nodo.value, ...estilo });
        break;
      case "strong":
        runs.push(...runsDe(nodo.children, { ...estilo, negrita: true }));
        break;
      case "emphasis":
        runs.push(...runsDe(nodo.children, { ...estilo, cursiva: true }));
        break;
      case "inlineCode":
        runs.push({ texto: nodo.value, ...estilo, codigo: true });
        break;
      case "delete":
      case "link":
      case "linkReference":
        runs.push(...runsDe(nodo.children, estilo));
        break;
      case "image":
      case "imageReference":
        if (nodo.alt) runs.push({ texto: nodo.alt, ...estilo });
        break;
      case "footnoteReference":
        runs.push({ texto: `[${nodo.label ?? nodo.identifier}]`, ...estilo });
        break;
      case "break":
        runs.push({ texto: "\n", ...estilo });
        break;
      case "html":
        break; // el HTML crudo no se imprime
      default:
        runs.push({ texto: textoDeNodo(nodo), ...estilo });
    }
  }
  return runs;
}

function listaDe(lista: List): Bloque {
  return {
    tipo: "lista",
    ordenada: lista.ordered === true,
    inicio: lista.start ?? 1,
    items: lista.children.map((item) => ({
      bloques: bloquesDe(item.children),
      marcado: typeof item.checked === "boolean" ? item.checked : null,
    })),
  };
}

/** La primera fila de una tabla GFM es el encabezado; sin alineación = izquierda. */
function tablaDe(tabla: Table): Bloque {
  const filas = tabla.children.map((fila) => fila.children.map((celda) => textoDeNodo(celda)));
  const [encabezado = [], ...cuerpo] = filas;
  const alineacion = (tabla.align ?? []).map((a): Alineacion => a ?? "left");
  return { tipo: "tabla", encabezado, filas: cuerpo, alineacion };
}

/** La nota al pie se imprime donde está, con su marca al frente: '[1] texto…'. */
function notaAlPieDe(nota: FootnoteDefinition): Bloque[] {
  const marca: Run = { texto: `[${nota.label ?? nota.identifier}] `, ...SIN_ESTILO };
  const [primero, ...resto] = bloquesDe(nota.children);
  if (!primero) return [{ tipo: "parrafo", runs: [marca] }];
  if (primero.tipo === "parrafo") {
    return [{ tipo: "parrafo", runs: [marca, ...primero.runs] }, ...resto];
  }
  return [{ tipo: "parrafo", runs: [marca] }, primero, ...resto];
}

function bloquesDe(nodos: RootContent[]): Bloque[] {
  const bloques: Bloque[] = [];
  for (const nodo of nodos) {
    switch (nodo.type) {
      case "heading":
        bloques.push({ tipo: "encabezado", nivel: nodo.depth, runs: runsDe(nodo.children) });
        break;
      case "paragraph":
        bloques.push({ tipo: "parrafo", runs: runsDe(nodo.children) });
        break;
      case "list":
        bloques.push(listaDe(nodo));
        break;
      case "table":
        bloques.push(tablaDe(nodo));
        break;
      case "code":
        bloques.push({ tipo: "codigo", texto: nodo.value });
        break;
      case "blockquote":
        bloques.push({ tipo: "cita", bloques: bloquesDe(nodo.children) });
        break;
      case "thematicBreak":
        bloques.push({ tipo: "linea" });
        break;
      case "footnoteDefinition":
        bloques.push(...notaAlPieDe(nodo));
        break;
      case "html":
      case "definition":
        break;
      default: {
        const texto = textoDeNodo(nodo);
        if (texto.trim()) bloques.push({ tipo: "parrafo", runs: [{ texto, ...SIN_ESTILO }] });
      }
    }
  }
  return bloques;
}

/** Parsea el markdown (CommonMark + tablas GFM) y lo aplana en bloques. */
export function markdownABloques(texto: string): Bloque[] {
  const arbol = unified().use(remarkParse).use(remarkGfm).parse(texto) as Root;
  return bloquesDe(arbol.children);
}

export function textoDeRuns(runs: Run[]): string {
  return runs.map((r) => r.texto).join("");
}
