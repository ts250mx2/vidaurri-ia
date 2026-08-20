// Genera public/marca-agua.png: el lockup de la casa en versión "sello", para
// estamparlo sobre las fotos del catálogo.
//
// Es una versión ADAPTADA del logo, no el logo tal cual. El logo original vive
// sobre un fondo controlado; el sello cae sobre lo que haya: el blanco de una
// foto de catálogo, la madera clara de la bodega o el plástico negro de una
// facia. Por eso cada trazo se dibuja DOS veces —primero un contorno blanco
// grueso, luego el relleno encima—: ese contorno es lo que despega la marca de
// un fondo oscuro, donde un texto gris con sombra simplemente desaparece.
//
//   node scripts/generar-marca-agua.mjs

import { mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(resolve(raiz, "package.json"));
const sharp = require("sharp");

mkdirSync(resolve(raiz, "public"), { recursive: true });

// Deja aire a la derecha y abajo: el sello se ancla en la esquina y sin este
// respiro el lockup queda pegado al filo de la foto.
const ANCHO = 660;
const ALTO = 190;

const FUENTE = "Montserrat, 'Arial Narrow', Arial, sans-serif";
const CONTORNO = 9;

/** Cada texto va en dos pasadas: el contorno blanco por debajo y el relleno
 *  encima. `paint-order` no es fiable en todos los renderers, así que se
 *  duplica el nodo en vez de confiar en él. */
function texto({ x, y, tam, peso, espaciado, relleno, contenido }) {
  const base = `x="${x}" y="${y}" font-family="${FUENTE}" font-size="${tam}" font-weight="${peso}" letter-spacing="${espaciado}"`;
  return `
    <text ${base} fill="none" stroke="#ffffff" stroke-width="${CONTORNO}"
          stroke-linejoin="round" opacity="0.92">${contenido}</text>
    <text ${base} fill="${relleno}">${contenido}</text>`;
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${ANCHO}" height="${ALTO}" viewBox="0 0 ${ANCHO} ${ALTO}">
  <defs>
    <linearGradient id="oroCara" x1="0.1" y1="0" x2="0.5" y2="1">
      <stop offset="0" stop-color="#f7e4a0"/>
      <stop offset="0.28" stop-color="#e8c455"/>
      <stop offset="0.62" stop-color="#d4af37"/>
      <stop offset="1" stop-color="#9a7b1f"/>
    </linearGradient>
    <linearGradient id="oroCanto" x1="1" y1="0" x2="0.35" y2="1">
      <stop offset="0" stop-color="#d4af37"/>
      <stop offset="0.5" stop-color="#a9821f"/>
      <stop offset="1" stop-color="#6f5514"/>
    </linearGradient>
  </defs>

  <!-- La V troquelada. El contorno blanco va como una V sólida por debajo,
       apenas más grande, para que el oro no se funda con un fondo oscuro. -->
  <g stroke="#ffffff" stroke-width="${CONTORNO}" stroke-linejoin="round" fill="#ffffff" opacity="0.92">
    <path d="M18 22h46l40 104-26 22z"/>
    <path d="M178 22h-40l-42 104 15 22z"/>
  </g>
  <path d="M18 22h46l40 104-26 22z" fill="url(#oroCara)"/>
  <path d="M178 22h-40l-42 104 15 22z" fill="url(#oroCanto)"/>
  <path d="M18 22h46l5 13H24z" fill="#fff8dc" opacity="0.55"/>

  ${texto({ x: 205, y: 76, tam: 46, peso: 700, espaciado: 6, relleno: "#4b535e", contenido: "AUTOPARTES" })}
  ${texto({ x: 205, y: 136, tam: 60, peso: 800, espaciado: 2, relleno: "#16181d", contenido: "VIDAURRI" })}
</svg>`;

const salida = resolve(raiz, "public", "marca-agua.png");
await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(salida);

const meta = await sharp(salida).metadata();
console.log(`marca-agua.png ${meta.width}x${meta.height}`);
