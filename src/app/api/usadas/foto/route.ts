import { sesionActual } from "@/lib/auth";
import { estamparMarca } from "@/lib/marca-agua";

export const dynamic = "force-dynamic";

// Proxy de las fotos de las piezas USADAS. El sistema de la Bodega Usado las
// sirve en https://sistema.apvidaurri.com/imagenes_piezas/ con el archivo que
// indica piezas_imagenes.nombre_imagen (se recibe en el parámetro `n`).
// Cachea, oculta el origen y devuelve 404 limpio cuando no hay foto.

// Las fotos salen SELLADAS con la marca de la casa: el mostrador las descarga
// de aqui para mandarlas al cliente, asi que tienen que ir marcadas igual que
// las que manda Vico. Sellar obliga a bufferear (adios al envio en flujo); la
// cache de abajo hace que se pague una vez por foto.

const BASE_FOTOS = "https://sistema.apvidaurri.com/imagenes_piezas";
const CACHE = "public, max-age=86400, s-maxage=604800"; // 1 día cliente, 7 días CDN

// Nombre de archivo plano (sin rutas): letras, dígitos, punto, guion y guion
// bajo, terminado en extensión de imagen. Los códigos de pieza traen "..." y
// eso es válido; el traversal real requiere '/' y aquí no se permite.
const NOMBRE_VALIDO = /^[A-Za-z0-9._-]{1,120}\.(jpg|jpeg|png|gif|webp)$/i;

export async function GET(request: Request) {
  const sesion = await sesionActual();
  if (!sesion) return new Response("No autorizado", { status: 401 });

  const nombre = (new URL(request.url).searchParams.get("n") ?? "").trim();
  if (!NOMBRE_VALIDO.test(nombre)) {
    return new Response("Nombre de imagen inválido", { status: 400 });
  }

  try {
    const res = await fetch(`${BASE_FOTOS}/${encodeURIComponent(nombre)}`, {
      signal: AbortSignal.timeout(15000),
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!res.ok || !res.body) return new Response("Sin foto", { status: 404 });
    const original = Buffer.from(await res.arrayBuffer());
    const bytes = (await estamparMarca(original)) ?? original;
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": res.headers.get("content-type") ?? "image/jpeg",
        "Cache-Control": CACHE,
      },
    });
  } catch {
    // Timeout o falla de red hacia el sitio de la bodega: se trata como "sin foto".
    return new Response("Sin foto", { status: 404 });
  }
}
