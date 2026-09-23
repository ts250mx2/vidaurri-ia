import { beforeEach, describe, expect, it, vi } from "vitest";
import { buscarAldo, destinoAldo, precioAldo, reiniciarAldo } from "./aldo";

// Cuando Aldo bloquea la IP del servidor, las consultas salen por un proxy
// propio (scripts/aldo-proxy.mjs). Va aparte de aldo.test.ts: solo prueba a
// dónde se manda la petición, no el parseo.

const HTML = "Cantidad Cofres CNVE15 COFRE VERSA 15-19 $2,200.00 $2,552.00 0.00 Mas de 60 ";
const ENV_PROXY = { ALDO_PROXY_URL: "http://100.64.0.2:3060/", ALDO_PROXY_KEY: "llave-compartida-de-prueba" };

const pedirOk = () =>
  vi.fn<typeof fetch>().mockImplementation(async () => new Response(Buffer.from(HTML, "latin1"), { status: 200 }));

beforeEach(() => reiniciarAldo());

describe("destinoAldo", () => {
  it("sin ALDO_PROXY_URL va directo a Aldo y sin encabezados extra", () => {
    expect(destinoAldo({})).toEqual({ url: "http://www.aldoautopartes.com/pi_resultados.jsp", headers: {} });
  });

  it("con proxy va a <proxy>/pi_resultados.jsp con la llave compartida", () => {
    expect(destinoAldo(ENV_PROXY)).toEqual({
      url: "http://100.64.0.2:3060/pi_resultados.jsp",
      headers: { "X-Aldo-Proxy-Key": "llave-compartida-de-prueba" },
    });
  });
});

describe("consultas por el proxy", () => {
  it("precioAldo manda la misma petición pero al proxy, y lee igual la respuesta", async () => {
    const pedir = pedirOk();

    const precio = await precioAldo("CNVE15", { fetch: pedir, env: ENV_PROXY });

    const [url, init] = pedir.mock.calls[0];
    expect(String(url)).toBe("http://100.64.0.2:3060/pi_resultados.jsp");
    expect(new Headers(init?.headers).get("x-aldo-proxy-key")).toBe("llave-compartida-de-prueba");
    expect(init?.body).toBe("codigo=CNVE15");
    expect(precio).toMatchObject({ encontrado: true, existencia: 0, proximoReparto: "Mas de 60", disponible: "Mas de 60" });
  });

  it("buscarAldo también sale por el proxy", async () => {
    const pedir = pedirOk();

    const filas = await buscarAldo("CNVE", { fetch: pedir, env: ENV_PROXY });

    expect(String(pedir.mock.calls[0][0])).toBe("http://100.64.0.2:3060/pi_resultados.jsp");
    expect(filas.map((f) => f.codigo)).toEqual(["CNVE15"]);
  });

  it("sin proxy configurado sigue yendo a Aldo directo", async () => {
    const pedir = pedirOk();

    await precioAldo("CNVE15", { fetch: pedir, env: {} });

    expect(String(pedir.mock.calls[0][0])).toBe("http://www.aldoautopartes.com/pi_resultados.jsp");
    expect(new Headers(pedir.mock.calls[0][1]?.headers).get("x-aldo-proxy-key")).toBeNull();
  });
});
