import sharp, { type OverlayOptions } from "sharp";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Sello de la casa sobre TODA foto que sale de aquí: las que el Vendedor IA
// manda por WhatsApp y las que el panel sirve al mostrador. Una foto de la
// bodega circula por grupos de Facebook y cotizadores ajenos en cuestión de
// horas; con el sello encima sigue diciendo de quién es la pieza.
//
// Son DOS capas con oficios distintos:
//   1. El MOSAICO: el lockup repetido en diagonal por toda la foto, muy tenue.
//      Es el que hace inservible la foto robada — recortar la esquina no lo
//      quita, habría que borrarlo pieza por pieza sobre la mercancía misma.
//   2. La ESQUINA inferior derecha, con cuerpo: la que se lee de un vistazo y
//      dice de quién es el negocio.
//
// El precio de esto es que la foto ya NO puede ir en flujo: hay que tenerla
// entera en memoria para componerla. Por eso las rutas que lo usan cachean
// fuerte — el costo se paga una vez por foto, no una vez por visita.
//
// GEMELO de vidaurri-page/src/lib/marca-agua.ts: si cambias el sello aquí,
// cámbialo allá, o el mismo producto saldrá marcado distinto en WhatsApp que
// en la página. El PNG se regenera con scripts/generar-marca-agua.mjs.

const RUTA_MARCA = join(process.cwd(), "public", "marca-agua.png");

/** Ancho del sello de esquina respecto al de la foto. Abajo del 26% el lockup
 *  deja de leerse en un celular; arriba del 40% empieza a tapar la pieza, que
 *  es lo que el cliente vino a ver. */
const PROPORCION = 0.32;
/** Igual que arriba pero para fotos chicas: proporcionalmente necesitan más
 *  sello para que "VIDAURRI" siga siendo una palabra y no una mancha gris. */
const PROPORCION_CHICA = 0.46;
const ANCHO_CHICO = 400;

/** Separación del filo, en proporción al ancho. */
const MARGEN = 0.03;

/** Opacidad del sello de esquina: se tiene que leer sin comerse la pieza. */
const OPACIDAD = 0.74;

/** Ancho de cada logo del mosaico, en proporción al de la foto. Más chico
 *  entran más, pero por debajo de ~0.18 el lockup deja de reconocerse y la
 *  trama pasa a ser sucio en vez de marca. */
const MOSAICO_ANCHO = 0.22;
/** Aire entre logos del mosaico, en proporción al logo. */
const MOSAICO_SEPARACION = 0.1;
/** Muy tenue A PROPÓSITO: tiene que estorbar a quien roba la foto, no a quien
 *  viene a ver la pieza. Subirlo de ~0.2 y el catálogo empieza a verse sucio. */
const MOSAICO_OPACIDAD = 0.16;
/** En diagonal: cuesta más de recortar o de tapar con un parche recto. */
const MOSAICO_GRADOS = -30;

/** Debajo de esto ni la V se distingue: el sello sería una mancha que ensucia
 *  la foto sin proteger nada. Solo cae aquí el muro decorativo del hero. */
const MINIMO_UTIL = 110;

/** Tope de memoria por foto. El catálogo no tiene originales de este tamaño;
 *  si aparece uno, pasa sin sellar antes que tumbar el proceso. */
const MAXIMO_BYTES = 12 * 1024 * 1024;

const TRANSPARENTE = { r: 0, g: 0, b: 0, alpha: 0 };

/** Capa de alfa uniforme: `dest-in` multiplica el alfa que ya trae el PNG por
 *  este valor, así el sello se transparenta entero sin perder el degradado del
 *  oro ni el contorno blanco. */
function velo(opacidad: number): OverlayOptions {
  return {
    input: Buffer.from([0, 0, 0, Math.round(opacidad * 255)]),
    raw: { width: 1, height: 1, channels: 4 },
    tile: true,
    blend: "dest-in",
  };
}

/** El PNG del sello se lee del disco una sola vez por proceso. */
let marcaOriginal: Promise<Buffer> | null = null;
function cargarMarca(): Promise<Buffer> {
  marcaOriginal ??= readFile(RUTA_MARCA);
  return marcaOriginal;
}

/** Piezas ya preparadas, por ancho en píxeles. Rearmarlas en cada foto de la
 *  parrilla sería repetir el mismo trabajo 24 veces. */
const sellosEsquina = new Map<number, Promise<Buffer>>();
const azulejos = new Map<number, Promise<Buffer>>();

function selloEsquina(ancho: number): Promise<Buffer> {
  const cacheado = sellosEsquina.get(ancho);
  if (cacheado) return cacheado;

  const tarea = cargarMarca().then((png) =>
    sharp(png).resize({ width: ancho }).composite([velo(OPACIDAD)]).png().toBuffer()
  );
  sellosEsquina.set(ancho, tarea);
  return tarea;
}

/**
 * Azulejo del mosaico: lleva DOS logos en diagonal dentro de la celda, de modo
 * que al repetirse las filas quedan escalonadas como ladrillos. Con un solo
 * logo por azulejo el patrón sale en rejilla alineada y deja pasillos limpios
 * entre columnas — justo por donde se recorta una foto para robarla.
 */
function azulejoMosaico(anchoLogo: number): Promise<Buffer> {
  const cacheado = azulejos.get(anchoLogo);
  if (cacheado) return cacheado;

  const tarea = (async () => {
    const png = await cargarMarca();
    // La rotación va sobre un buffer YA cerrado: encadenada al resize, sharp
    // reordena las operaciones y el giro no siempre se aplica.
    const chico = await sharp(png).resize({ width: anchoLogo }).png().toBuffer();
    const logo = await sharp(chico)
      .rotate(MOSAICO_GRADOS, { background: TRANSPARENTE })
      .png()
      .toBuffer();

    const { width = anchoLogo, height = anchoLogo } = await sharp(logo).metadata();
    const aireX = Math.round(width * MOSAICO_SEPARACION);
    const aireY = Math.round(height * MOSAICO_SEPARACION);
    const celdaAncho = width + aireX;
    const celdaAlto = height + aireY;

    const trama = await sharp({
      create: {
        width: celdaAncho * 2,
        height: celdaAlto * 2,
        channels: 4,
        background: TRANSPARENTE,
      },
    })
      .composite([
        { input: logo, top: Math.round(aireY / 2), left: Math.round(aireX / 2) },
        {
          input: logo,
          top: celdaAlto + Math.round(aireY / 2),
          left: celdaAncho + Math.round(aireX / 2),
        },
      ])
      .png()
      .toBuffer();

    // Segunda pasada para el velo: sharp NO acumula composite() encadenados,
    // el segundo reemplaza al primero y la trama saldría vacía.
    return sharp(trama).composite([velo(MOSAICO_OPACIDAD)]).png().toBuffer();
  })();

  azulejos.set(anchoLogo, tarea);
  return tarea;
}

/**
 * Estampa el mosaico y el sello de esquina.
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

    const anchoEsquina = Math.round(
      width * (width < ANCHO_CHICO ? PROPORCION_CHICA : PROPORCION)
    );
    const [azulejo, sello] = await Promise.all([
      azulejoMosaico(Math.round(width * MOSAICO_ANCHO)),
      selloEsquina(anchoEsquina),
    ]);
    const { height: altoSello = 0 } = await sharp(sello).metadata();

    const margen = Math.round(width * MARGEN);
    // Si el sello no cabe a lo alto se ancla en 0 antes que dejar que sharp
    // reviente por un `top` negativo.
    const top = Math.max(0, height - altoSello - margen);
    const left = Math.max(0, width - anchoEsquina - margen);

    // Las dos capas en UN composite y en este orden: el mosaico cubre la foto y
    // el sello de esquina va encima, para que no se lo coma la trama.
    return await foto
      .composite([
        { input: azulejo, tile: true, blend: "over" },
        { input: sello, top, left },
      ])
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
