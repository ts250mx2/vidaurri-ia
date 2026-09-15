import { exigirCliente } from "@/lib/auth-clientes";
import { cambiarPasswordCliente } from "@/lib/clientes-entrar";
import { leerCuerpo, respuestaError, respuestaOk } from "@/lib/mostrador-api";

// Cambiar la contraseña del cliente de la sesión: body { actual, nueva }.
// 401 si la actual no es la suya, 400 con el motivo si la nueva no sirve
// (8..64, sin espacios en las puntas, distinta de su celular). Al guardar el
// hash nuevo deja de ser "contraseña por defecto". Responde { ok: true }.

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const guardia = await exigirCliente(request);
  if (!guardia.ok) return guardia.respuesta;

  const lectura = await leerCuerpo(request);
  if (!lectura.ok) return lectura.respuesta;

  const cambio = await cambiarPasswordCliente(guardia.cliente, lectura.cuerpo);
  if (!cambio.ok) return respuestaError(cambio.error, cambio.status);
  return respuestaOk();
}
