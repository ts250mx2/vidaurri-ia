// Proxy mínimo hacia el catálogo de Aldo Autopartes, para cuando Aldo bloquea
// la IP del servidor de producción: se corre en OTRA máquina que sí alcance
// www.aldoautopartes.com (p. ej. por Tailscale) y el servidor le manda ahí las
// consultas (ALDO_PROXY_URL / ALDO_PROXY_KEY en el .env de vidaurri-ia y
// vidaurri-page).
//
// Solo reenvía POST /pi_resultados.jsp con el cuerpo tal cual y devuelve los
// bytes de Aldo sin tocarlos (el sitio responde en ISO-8859-1; la app ya lo
// decodifica). Exige la llave compartida en X-Aldo-Proxy-Key: sin ella, 401.
//
// Uso:
//   ALDO_PROXY_KEY=<llave larga> node scripts/aldo-proxy.mjs
//   Opcionales: PORT (3060), HOST (0.0.0.0; conviene la IP de Tailscale de la
//   máquina, p. ej. 100.x.y.z, para no exponerlo a internet).
// Con pm2:  pm2 start scripts/aldo-proxy.mjs --name aldo-proxy

import { createServer } from "node:http";

const ALDO = "http://www.aldoautopartes.com/pi_resultados.jsp";
const PUERTO = Number(process.env.PORT) || 3060;
const HOST = process.env.HOST || "0.0.0.0";
const LLAVE = (process.env.ALDO_PROXY_KEY ?? "").trim();
const TIMEOUT_MS = 15000;
const MAX_CUERPO = 1024;

if (LLAVE.length < 16) {
  console.error("Falta ALDO_PROXY_KEY (mínimo 16 caracteres).");
  process.exit(1);
}

function responder(res, status, texto) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(texto);
}

createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/pi_resultados.jsp") return responder(res, 404, "No encontrado");
  if (req.headers["x-aldo-proxy-key"] !== LLAVE) return responder(res, 401, "Sin autorización");

  const trozos = [];
  let tamano = 0;
  req.on("data", (t) => {
    tamano += t.length;
    if (tamano > MAX_CUERPO) req.destroy();
    else trozos.push(t);
  });
  req.on("end", async () => {
    const cuerpo = Buffer.concat(trozos).toString("utf8");
    const inicio = Date.now();
    try {
      const r = await fetch(ALDO, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Mozilla/5.0" },
        body: cuerpo,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const bytes = Buffer.from(await r.arrayBuffer());
      res.writeHead(r.status, { "Content-Type": r.headers.get("content-type") ?? "text/html" });
      res.end(bytes);
      console.log(`${new Date().toISOString()} ${cuerpo.slice(0, 40)} -> ${r.status} ${bytes.length}B ${Date.now() - inicio}ms`);
    } catch (error) {
      console.error(`${new Date().toISOString()} ${cuerpo.slice(0, 40)} -> falló: ${error?.message ?? error}`);
      responder(res, 502, "Aldo no respondió");
    }
  });
}).listen(PUERTO, HOST, () => {
  console.log(`aldo-proxy escuchando en http://${HOST}:${PUERTO}/pi_resultados.jsp`);
});
