import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BYTES_MAX,
  ImagenInvalidaError,
  descargarImagen,
  leerImagenesDelCuerpo,
  normalizarImagen,
  prepararImagenes,
  urlDeMediaPermitida,
} from "./imagenes-mensaje";

/** Una foto de verdad, generada aquí mismo. */
function foto(ancho: number, alto: number, opciones: { orientacion?: number; formato?: "jpeg" | "png" } = {}) {
  let imagen = sharp({ create: { width: ancho, height: alto, channels: 3, background: { r: 180, g: 83, b: 9 } } });
  if (opciones.orientacion) imagen = imagen.withMetadata({ orientation: opciones.orientacion });
  return (opciones.formato === "png" ? imagen.png() : imagen.jpeg()).toBuffer();
}

const respuestaCon = (bytes: Buffer, headers: Record<string, string> = {}) =>
  new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": "application/octet-stream", ...headers } });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("leerImagenesDelCuerpo", () => {
  it("acepta un arreglo de URLs, base64 u objetos, y los atajos de una sola imagen", () => {
    expect(leerImagenesDelCuerpo({ imagenes: ["https://media.ejemplo.com/a.jpg", { base64: "aGVsbG8=" }] })).toEqual({
      ok: true,
      imagenes: [
        { tipo: "url", url: "https://media.ejemplo.com/a.jpg" },
        { tipo: "base64", base64: "aGVsbG8=" },
      ],
    });
    expect(leerImagenesDelCuerpo({ imagenUrl: "https://media.ejemplo.com/b.jpg" })).toEqual({
      ok: true,
      imagenes: [{ tipo: "url", url: "https://media.ejemplo.com/b.jpg" }],
    });
    expect(leerImagenesDelCuerpo({ imagen: "data:image/jpeg;base64,aGVsbG8=" })).toEqual({
      ok: true,
      imagenes: [{ tipo: "base64", base64: "aGVsbG8=" }],
    });
  });

  it("una variable de la pasarela sin valor no es una foto", () => {
    expect(leerImagenesDelCuerpo({ mensaje: "hola" })).toEqual({ ok: true, imagenes: [] });
    expect(leerImagenesDelCuerpo({ imagenUrl: "", imagen: null })).toEqual({ ok: true, imagenes: [] });
    expect(leerImagenesDelCuerpo({ imagenes: ["", null] })).toEqual({ ok: true, imagenes: [] });
  });

  it("rechaza más de tres y lo que no es URL ni base64", () => {
    const cuatro = Array.from({ length: 4 }, (_, i) => `https://media.ejemplo.com/${i}.jpg`);
    expect(leerImagenesDelCuerpo({ imagenes: cuatro })).toMatchObject({ ok: false });
    expect(leerImagenesDelCuerpo({ imagenes: ["{{mensaje.media}}"] })).toMatchObject({ ok: false });
    expect(leerImagenesDelCuerpo({ imagenes: [42] })).toMatchObject({ ok: false });
  });
});

describe("urlDeMediaPermitida", () => {
  it("solo https, sin credenciales y nunca a la red interna", () => {
    expect(urlDeMediaPermitida("https://media.ejemplo.com/a.jpg", {}).hostname).toBe("media.ejemplo.com");
    for (const mala of [
      "http://media.ejemplo.com/a.jpg",
      "https://usuario:clave@media.ejemplo.com/a.jpg",
      "https://localhost/a.jpg",
      "https://127.0.0.1:3056/api/ws/llave/x",
      "https://10.0.0.5/a.jpg",
      "https://169.254.169.254/latest/meta-data",
      "https://[::1]/a.jpg",
      "https://servidor.internal/a.jpg",
      "ftp://media.ejemplo.com/a.jpg",
      "no es una url",
    ]) {
      expect(() => urlDeMediaPermitida(mala, {}), mala).toThrow(ImagenInvalidaError);
    }
  });

  it("con WHATSAPP_MEDIA_HOSTS solo pasan esos hosts y sus subdominios", () => {
    const env = { WHATSAPP_MEDIA_HOSTS: "axonlogic.com.mx, cdn.ejemplo.com" };
    expect(urlDeMediaPermitida("https://media.axonlogic.com.mx/x.jpg", env).hostname).toBe("media.axonlogic.com.mx");
    expect(urlDeMediaPermitida("https://cdn.ejemplo.com/x.jpg", env).hostname).toBe("cdn.ejemplo.com");
    expect(() => urlDeMediaPermitida("https://otro.com/x.jpg", env)).toThrow(/WHATSAPP_MEDIA_HOSTS/);
    expect(() => urlDeMediaPermitida("https://malaxonlogic.com.mx/x.jpg", env)).toThrow(ImagenInvalidaError);
  });
});

describe("descargarImagen", () => {
  it("valida cada redirección: un salto hacia la red interna se rechaza", async () => {
    const pedir = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://127.0.0.1/secreto" } }));

    await expect(descargarImagen("https://media.ejemplo.com/a.jpg", { fetch: pedir, env: {} })).rejects.toThrow(
      /no permitida/
    );
    expect(pedir).toHaveBeenCalledTimes(1);
  });

  it("sigue una redirección legítima y entrega los bytes", async () => {
    const bytes = await foto(40, 30);
    const pedir = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://cdn.ejemplo.com/real.jpg" } }))
      .mockResolvedValueOnce(respuestaCon(bytes));

    const recibido = await descargarImagen("https://media.ejemplo.com/a.jpg", { fetch: pedir, env: {} });

    expect(recibido.equals(bytes)).toBe(true);
    expect(String(pedir.mock.calls[1][0])).toBe("https://cdn.ejemplo.com/real.jpg");
  });

  it("el token solo viaja a un host de la lista blanca; sin lista, a nadie", async () => {
    const bytes = await foto(40, 30);
    const pedir = vi.fn<typeof fetch>().mockImplementation(async () => respuestaCon(bytes));
    const autorizacionDe = (llamada: number) => new Headers(pedir.mock.calls[llamada][1]?.headers).get("authorization");

    await descargarImagen("https://media.axonlogic.com.mx/a.jpg", {
      fetch: pedir,
      env: { WHATSAPP_MEDIA_HOSTS: "axonlogic.com.mx", WHATSAPP_MEDIA_AUTH: "Bearer secreto" },
    });
    await descargarImagen("https://media.ejemplo.com/a.jpg", { fetch: pedir, env: { WHATSAPP_MEDIA_AUTH: "Bearer secreto" } });

    expect(autorizacionDe(0)).toBe("Bearer secreto");
    expect(autorizacionDe(1)).toBeNull();
  });

  it("corta una respuesta que se pasa del tope aunque no declare su tamaño", async () => {
    const enorme = Buffer.alloc(BYTES_MAX + 1024, 1);
    const pedir = vi.fn<typeof fetch>().mockImplementation(async () => respuestaCon(enorme));

    await expect(descargarImagen("https://media.ejemplo.com/a.jpg", { fetch: pedir, env: {} })).rejects.toThrow(
      /demasiado grande/
    );
  });
});

describe("normalizarImagen", () => {
  it("reduce una foto grande, la deja en JPEG y sin metadatos", async () => {
    const lista = await normalizarImagen(await foto(4000, 3000, { formato: "png" }));
    const meta = await sharp(Buffer.from(lista.base64, "base64")).metadata();

    expect(lista.mediaType).toBe("image/jpeg");
    expect(meta.format).toBe("jpeg");
    expect([meta.width, meta.height]).toEqual([1568, 1176]);
    expect(meta.exif).toBeUndefined();
  });

  it("endereza la foto según su orientación EXIF (las de celular vienen acostadas)", async () => {
    // Orientación 6 = hay que girarla 90°: lo que se guardó 400x200 en realidad es 200x400.
    const lista = await normalizarImagen(await foto(400, 200, { orientacion: 6 }));
    const meta = await sharp(Buffer.from(lista.base64, "base64")).metadata();

    expect([meta.width, meta.height]).toEqual([200, 400]);
    expect(meta.orientation).toBeUndefined();
  });

  it("no agranda una foto chica", async () => {
    const lista = await normalizarImagen(await foto(320, 240));
    const meta = await sharp(Buffer.from(lista.base64, "base64")).metadata();

    expect([meta.width, meta.height]).toEqual([320, 240]);
  });

  it("lo que no es una imagen no pasa, aunque venga con nombre de imagen", async () => {
    await expect(normalizarImagen(Buffer.from("<html>no soy una foto</html>"))).rejects.toBeInstanceOf(ImagenInvalidaError);
  });
});

describe("prepararImagenes", () => {
  it("una foto ilegible no tumba a las demás: se cuenta como fallida", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const buena = (await foto(60, 40)).toString("base64");

    const { listas, fallidas } = await prepararImagenes([
      { tipo: "base64", base64: buena },
      { tipo: "base64", base64: Buffer.from("basura").toString("base64") },
      { tipo: "url", url: "https://127.0.0.1/x.jpg" },
    ]);

    expect(listas).toHaveLength(1);
    expect(listas[0].mediaType).toBe("image/jpeg");
    expect(fallidas).toBe(2);
  });
});
