import { apiKeyValida } from "@/lib/api-key";
import { respuestaNoAutorizadoCliente } from "@/lib/auth-clientes";
import { entrarCliente, ipClienteDe } from "@/lib/clientes-entrar";
import { leerCuerpo, respuestaError, respuestaOk } from "@/lib/mostrador-api";

// Entrar al área de clientes: body { usuario, password }, con la API key de
// servidor a servidor (vidaurri-page firma después su cookie con lo que aquí
// se responde). El usuario es el celular del padrón; la primera vez la
// contraseña es ese mismo celular y aquí se crea su cuenta (clientes_acceso).
// "No está en el padrón" y "contraseña mala" son la misma respuesta (401).
// Topes: 5 intentos por usuario y 5 por IP confiable (x-cliente-ip) cada 10
// minutos. Responde SOLO { idCliente, nombre, telefono, descuento,
// permitirPedido, passwordPorDefecto }.

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!apiKeyValida(request, "MOSTRADOR_API_KEY")) return respuestaNoAutorizadoCliente("api_key");

  const lectura = await leerCuerpo(request);
  if (!lectura.ok) return lectura.respuesta;

  const entrada = await entrarCliente(lectura.cuerpo, { ip: ipClienteDe(request) });
  if (!entrada.ok) return respuestaError(entrada.error, entrada.status);
  return respuestaOk({ ...entrada.sesion });
}
