import { sesionActual } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Proxy de la foto del artículo en el catálogo de Aldo Autopartes (S3), por
// código. El servidor la trae y la re-sirve para: cachearla, evitar exponer la
// estructura del bucket, y funcionar aunque el cliente no tenga salida directa
// a internet. Sin foto → 404 y el frontend muestra un marcador.

const BASE_S3 = "https://s3-us-west-2.amazonaws.com/aldoautopartesproductos";
// Códigos válidos del catálogo: letras, dígitos y . _ - (los corruptos quedan fuera).
const CODIGO_VALIDO = /^[A-Za-z0-9._-]{1,50}$/;
const CACHE = "public, max-age=86400, s-maxage=604800"; // 1 día cliente, 7 días CDN

export async function GET(request: Request) {
  const sesion = await sesionActual();
  if (!sesion) return new Response("No autorizado", { status: 401 });

  const { searchParams } = new URL(request.url);
  const codigo = (searchParams.get("codigo") ?? "").trim();
  const thumb = searchParams.get("thumb") === "1";
  if (!CODIGO_VALIDO.test(codigo)) {
    return new Response("Código inválido", { status: 400 });
  }

  const urlS3 = thumb
    ? `${BASE_S3}/_thumbs/${encodeURIComponent(codigo)}.jpg`
    : `${BASE_S3}/${encodeURIComponent(codigo)}.jpg`;

  try {
    const res = await fetch(urlS3, {
      signal: AbortSignal.timeout(15000),
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!res.ok || !res.body) {
      return new Response("Sin foto", { status: 404 });
    }
    return new Response(res.body, {
      status: 200,
      headers: {
        "Content-Type": res.headers.get("content-type") ?? "image/jpeg",
        "Cache-Control": CACHE,
      },
    });
  } catch {
    // Timeout o falla de red hacia S3: se trata como "sin foto".
    return new Response("Sin foto", { status: 404 });
  }
}
