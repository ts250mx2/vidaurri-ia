import { fotoAldoExiste, urlFotoAldo } from "@/lib/aldo";

// Fotos que acompañan una respuesta de Vico en los canales sin imágenes
// inline (WhatsApp y el mostrador). El agente marca los productos sugeridos
// con una línea técnica [[FOTOS: cod1, cod2]] al final; aquí se separa esa
// línea del texto visible, se verifica que los códigos sean reales (los
// devolvió una herramienta en este turno) y con foto, y se arma la URL del
// proxy sellado. Lo comparten /api/whatsapp/vendedor y /api/mostrador/vico
// sin cambiar el contrato del webservice de Axon.

/** Fotos por respuesta: WhatsApp se satura con más. */
export const MAX_FOTOS_RESPUESTA = 3;

export interface FotoRespuesta {
  codigo: string;
  url: string;
}

// Fotos: se entregan por el proxy propio /api/whatsapp/foto con una marca
// ÚNICA DENTRO DE LA RUTA. Sin esto, la pasarela de WhatsApp reenviaba la
// imagen cacheada del producto anterior (con el pie de foto del nuevo); un
// `?v=` no basta porque hay cachés que solo consideran la ruta.
const BASES_FOTO = [
  { prefijo: "https://s3-us-west-2.amazonaws.com/aldoautopartesproductos/", origen: "aldo" },
  { prefijo: "https://sistema.apvidaurri.com/imagenes_piezas/", origen: "usadas" },
];

/** Convierte la URL original de la foto en una del proxy, con ruta única. */
// El proxy es lo que pone la marca de agua: una URL que no pase por él sale del
// origen tal cual, sin sello. Se sigue mandando —mejor foto sin marca que pieza
// sin foto—, pero queda registrado: si esto se repite, el catálogo entero se
// está publicando sin marca y nadie se entera.
export function urlFotoWhatsapp(urlOriginal: string, base: string, marca: string): string {
  if (base) {
    for (const { prefijo, origen } of BASES_FOTO) {
      if (urlOriginal.startsWith(prefijo)) {
        const archivo = decodeURIComponent(urlOriginal.slice(prefijo.length).split("?")[0]);
        return `${base}/api/whatsapp/foto/${marca}/${origen}/${encodeURIComponent(archivo)}`;
      }
    }
  }
  console.warn(
    `[foto-whatsapp] se manda SIN marca de agua (no pasa por el proxy): ${
      base ? "origen desconocido" : "falta PUBLIC_BASE_URL y no hay host en la petición"
    } -> ${urlOriginal}`
  );
  return urlOriginal;
}

/** Marca única por respuesta: evita que la pasarela reenvíe una foto cacheada. */
export function marcaUnica(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

const MARCADOR_FOTOS = /\[\[FOTOS:\s*([^\]]*)\]\]/i;
const TODOS_LOS_MARCADORES = /\[\[FOTOS:[^\]]*\]\]/gi;

/**
 * Separa la línea técnica [[FOTOS: ...]] del texto que verá el cliente.
 * `codigosMarcados` son los códigos tal como los escribió el agente (aún sin
 * verificar); `texto` puede quedar vacío si la respuesta era solo el marcador.
 */
export function separarMarcadorFotos(respuesta: string): { texto: string; codigosMarcados: string[] } {
  const marcador = respuesta.match(MARCADOR_FOTOS);
  const texto = respuesta.replace(TODOS_LOS_MARCADORES, "").trim();
  const codigosMarcados = (marcador?.[1] ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
  return { texto, codigosMarcados };
}

export interface OpcionesFotos {
  /** Códigos que el agente marcó en [[FOTOS: ...]]. */
  codigosMarcados: string[];
  /** Códigos que devolvieron las búsquedas del turno (los únicos aceptados). */
  codigosConsultados: Iterable<string>;
  /** Código (en mayúsculas) → URL pública de la foto de cada pieza usada. */
  fotosUsadas: Map<string, string>;
  /** Origen público del sistema para el proxy sellado ('' si no se conoce). */
  base: string;
}

/**
 * Fotos verificadas de los productos marcados, ya con URL del proxy. Solo se
 * aceptan códigos REALES (que el catálogo devolvió) y con foto, para no mandar
 * enlaces inventados ni rotos. Pieza usada: su foto ya viene con URL pública
 * de la Bodega. Producto nuevo: se verifica que exista en el S3 de Aldo.
 */
export async function fotosDeRespuesta(op: OpcionesFotos): Promise<FotoRespuesta[]> {
  const reales = new Map([...op.codigosConsultados].map((c) => [c.toUpperCase(), c] as const));
  const pedidos = op.codigosMarcados
    .map((c) => reales.get(c.toUpperCase()))
    .filter((c): c is string => Boolean(c))
    .slice(0, MAX_FOTOS_RESPUESTA);

  const verificadas = await Promise.all(
    pedidos.map(async (codigo) => {
      const urlUsada = op.fotosUsadas.get(codigo.toUpperCase());
      if (urlUsada) return { codigo, url: urlUsada };
      return { codigo, url: (await fotoAldoExiste(codigo)) ? urlFotoAldo(codigo) : null };
    })
  );
  const marca = marcaUnica();
  return verificadas
    .filter((f): f is FotoRespuesta => Boolean(f.url))
    .map((f) => ({ codigo: f.codigo, url: urlFotoWhatsapp(f.url, op.base, marca) }));
}
