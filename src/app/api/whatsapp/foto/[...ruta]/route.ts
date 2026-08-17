// Proxy PÚBLICO de fotos para WhatsApp, con ruta única por envío.
//
// Por qué existe: las pasarelas de WhatsApp reutilizan la imagen que ya
// enviaron (el cliente recibía la foto del producto anterior con el pie de
// foto del nuevo). Un parámetro `?v=` no siempre basta, porque algunas cachés
// solo consideran la RUTA. Aquí la marca va DENTRO de la ruta, así que cada
// envío es un recurso distinto para cualquier caché.
//
// Formato:  /api/whatsapp/foto/{marca}/{origen}/{archivo}
//   marca   — valor único por respuesta (solo rompe la caché; no se valida)
//   origen  — 'aldo' (catálogo nuevo) | 'usadas' (Bodega Usado)
//   archivo — nombre del archivo de imagen
//
// Es público (WhatsApp descarga la imagen sin sesión), pero NO es un proxy
// abierto: solo resuelve contra dos orígenes fijos y con nombre de archivo
// validado, así que no puede usarse para traer URLs arbitrarias.

export const dynamic = "force-dynamic";

const ORIGENES: Record<string, string> = {
  aldo: "https://s3-us-west-2.amazonaws.com/aldoautopartesproductos",
  usadas: "https://sistema.apvidaurri.com/imagenes_piezas",
};

// Nombre de archivo plano: sin '/' ni '..', terminado en extensión de imagen.
const ARCHIVO_VALIDO = /^[A-Za-z0-9._-]{1,120}\.(jpg|jpeg|png|webp)$/i;

// La ruta es única por envío, así que la imagen puede cachearse sin riesgo.
const CACHE = "public, max-age=604800, immutable";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ ruta: string[] }> }
) {
  const { ruta } = await params;
  // [marca, origen, archivo]
  if (!Array.isArray(ruta) || ruta.length !== 3) {
    return new Response("Ruta inválida", { status: 400 });
  }
  const [marca, origen, archivo] = ruta;
  const base = ORIGENES[origen];
  if (!base || !ARCHIVO_VALIDO.test(archivo)) {
    return new Response("Foto no disponible", { status: 400 });
  }

  // Registro: sirve para comprobar si la pasarela realmente descarga la foto
  // de este envío. Si un producto se manda por WhatsApp y aquí NO aparece su
  // archivo, es que la pasarela reenvió una imagen cacheada suya.
  const quien = (request.headers.get("user-agent") ?? "?").slice(0, 60);
  console.log(`[foto-whatsapp] ${origen}/${archivo} marca=${marca} ua="${quien}"`);

  try {
    const res = await fetch(`${base}/${encodeURIComponent(archivo)}`, {
      signal: AbortSignal.timeout(15000),
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!res.ok) return new Response("Sin foto", { status: 404 });
    // Se entrega con Content-Length (no "chunked"): el descargador de medios de
    // WhatsApp/Meta es más estricto y algunas pasarelas descartan la imagen si
    // no sabe el tamaño de antemano.
    const bytes = await res.arrayBuffer();
    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": res.headers.get("content-type") ?? "image/jpeg",
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": CACHE,
      },
    });
  } catch {
    return new Response("Sin foto", { status: 404 });
  }
}
