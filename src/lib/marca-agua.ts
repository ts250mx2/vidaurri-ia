import sharp from "sharp";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Sello de la casa sobre TODA foto que sale de aquí: las que el Vendedor IA
// manda por WhatsApp y las que el panel sirve al mostrador. Una foto de la
// bodega circula por grupos de Facebook y cotizadores ajenos en cuestión de
// horas; con el sello encima sigue diciendo de quién es la pieza.
//
// El precio de esto es que la foto ya NO puede ir en flujo: hay que tenerla
// entera en memoria para componerla. Por eso las rutas que lo usan cachean
// fuerte — el costo se paga una vez por foto, no una vez por visita.
//
// GEMELO de vidaurri-page/src/lib/marca-agua.ts: si cambias el sello aquí,
// cámbialo allá, o el mismo producto saldrá marcado distinto en WhatsApp que
// en la página. El PNG se regenera con scripts/generar-marca-agua.mjs.

const RUTA_MARCA = join(process.cwd(), "public", "marca-agua.png");

/** Ancho del sello respecto al de la foto. Abajo del 26% el lockup deja de
 *  leerse en un celular; arriba del 40% empieza a tapar la pieza, que es lo
 *  que el cliente vino a ver. */
const PROPORCION = 0.32;
/** Igual que arriba pero para fotos chicas: proporcionalmente necesitan más
 *  sello para que "VIDAURRI" siga siendo una palabra y no una mancha gris. */
const PROPORCION_CHICA = 0.46;
const ANCHO_CHICO = 400;

/** Separación del filo, en proporción al ancho. */
const MARGEN = 0.03;

/** Opacidad del sello: se tiene que leer sin comerse la pieza. */
const OPACIDAD = 0.74;

/** Debajo de esto ni la V se distingue: el sello sería una mancha que ensucia
 *  la foto sin proteger nada. Solo cae aquí el muro decorativo del hero. */
const MINIMO_UTIL = 110;

/** Tope de memoria por foto. El catálogo no tiene originales de este tamaño;
 *  si aparece uno, pasa sin sellar antes que tumbar el proceso. */
const MAXIMO_BYTES = 12 * 1024 * 1024;

/** El PNG del sello se lee del disco una sola vez por proceso. */
let marcaOriginal: Promise<Buffer> | null = null;
function cargarMarca(): Promise<Buffer> {
  marcaOriginal ??= readFile(RUTA_MARCA);
  return marcaOriginal;
}

/** Sellos ya escalados y con su alfa aplicado, por ancho en píxeles. Escalar el
 *  PNG en cada foto de la parrilla sería repetir el mismo trabajo 24 veces. */
const escalados = new Map<number, Promise<Buffer>>();

function marcaEscalada(ancho: number): Promise<Buffer> {
  const cacheado = escalados.get(ancho);
  if (cacheado) return cacheado;

  const tarea = cargarMarca().then((png) =>
    sharp(png)
      .resize({ width: ancho })
      // `dest-in` multiplica el alfa que ya trae el PNG por este valor uniforme,
      // así el sello se transparenta entero sin perder el degradado del oro.
      .composite([
        {
          input: Buffer.from([0, 0, 0, Math.round(OPACIDAD * 255)]),
          raw: { width: 1, height: 1, channels: 4 },
          tile: true,
          blend: "dest-in",
        },
      ])
      .png()
      .toBuffer()
  );

  escalados.set(ancho, tarea);
  return tarea;
}

/**
 * Estampa el sello de la casa en la esquina inferior derecha.
 *
 * Devuelve `null` cuando la foto debe servirse tal cual (no es imagen, es
 * demasiado grande o demasiado chica para que el sello signifique algo) y
 * también cuando el sellado falla: una foto sin sello es mejor que una pieza
 * sin foto. El fallo se registra — si esto empieza a fallar en silencio, el
 * catálogo entero se publica sin marca y nadie se entera.
 */
export async function estamparMarca(entrada: Buffer): Promise<Buffer | null> {
  if (entrada.byteLength > MAXIMO_BYTES) {
    console.warn(
      `[marca-agua] foto de ${Math.round(entrada.byteLength / 1024)} KB por encima del tope: se sirve sin sello`
    );
    return null;
  }

  try {
    const foto = sharp(entrada, { failOn: "none" });
    const { width, height, format } = await foto.metadata();

    if (!width || !height || width < MINIMO_UTIL) return null;
    // Un GIF animado perdería la animación al recomponerlo, y el SVG no es una
    // foto de pieza: ninguno de los dos llega por estas rutas, pero si llega,
    // pasa intacto.
    if (format === "gif" || format === "svg") return null;

    const anchoSello = Math.round(
      width * (width < ANCHO_CHICO ? PROPORCION_CHICA : PROPORCION)
    );
    const sello = await marcaEscalada(anchoSello);
    const { height: altoSello = 0 } = await sharp(sello).metadata();

    const margen = Math.round(width * MARGEN);
    // Si la foto es más ancha que alta por muy poco, el sello podría no caber
    // a lo alto: se ancla en 0 antes que dejar que sharp reviente por un
    // `top` negativo.
    const top = Math.max(0, height - altoSello - margen);
    const left = Math.max(0, width - anchoSello - margen);

    return await foto
      .composite([{ input: sello, top, left }])
      .toBuffer();
  } catch (error) {
    console.error("[marca-agua] no se pudo sellar la foto:", error);
    return null;
  }
}

/**
 * Descarga una foto y la devuelve sellada, lista para responder.
 * Centraliza el "bufferea, sella, y si algo falla sirve el original" que
 * necesitan por igual la ruta de nuevas y la de usadas.
 */
export async function sellarRespuesta(
  respuesta: Response
): Promise<{ cuerpo: Buffer; tipo: string } | null> {
  const declarado = respuesta.headers.get("content-type") ?? "";
  if (!respuesta.body || !declarado.startsWith("image/")) {
    await respuesta.body?.cancel();
    return null;
  }

  const original = Buffer.from(await respuesta.arrayBuffer());
  const sellada = await estamparMarca(original);
  if (!sellada) return { cuerpo: original, tipo: declarado };

  // El tipo se toma del formato que sharp REALMENTE produjo, no del que declaró
  // el origen. El S3 rotula `image/jpeg` archivos que a veces son PNG, y como
  // estas rutas responden con `nosniff`, un tipo equivocado hace que el
  // navegador descarte la imagen en vez de corregirlo por su cuenta.
  const { format } = await sharp(sellada).metadata();
  return {
    cuerpo: sellada,
    tipo: format ? `image/${format}` : declarado,
  };
}
