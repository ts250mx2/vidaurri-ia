import { exigirKiosco } from "@/lib/auth-kiosco";
import { validarCredenciales } from "@/lib/clientes-acceso";
import { entrarCliente, ipClienteDe } from "@/lib/clientes-entrar";
import { cancelarBorrador } from "@/lib/db-pedidos";
import { AREA_KIOSCO, CANAL_KIOSCO, actorCapturaKiosco, crearCupo } from "@/lib/kiosco-api";
import { ERROR_CUPO_ENTRADAS, LIMITE_ENTRADAS_KIOSCO } from "@/lib/kiosco-cliente";
import { leerCuerpo, respuestaDeError, respuestaError, respuestaOk } from "@/lib/mostrador-api";

// El cliente registrado entra al kiosco con su celular (usuario) y su
// contraseña, que la primera vez es el mismo celular: la MISMA cuenta y la
// misma lógica que el área de clientes (clientes-entrar.ts: padrón,
// clientes_acceso, 401 idéntico para "no está" y "contraseña mala", topes por
// usuario y por IP). Responde lo mismo que /api/clientes/entrar, que es lo
// que vidaurri-page firma en la cookie del cliente del kiosco.
//
// Encima, el tope por APARATO (10 cada 10 minutos): la pantalla del piso la
// teclea cualquiera. Al entrar se descarta el borrador vivo del aparato: lo
// que armó el anónimo (a precio de mostrador) no se hereda al cliente.

export const dynamic = "force-dynamic";

const cupo = crearCupo(LIMITE_ENTRADAS_KIOSCO);

export async function POST(request: Request) {
  const guardia = await exigirKiosco(request);
  if (!guardia.ok) return guardia.respuesta;
  const { kiosco } = guardia;

  const lectura = await leerCuerpo(request);
  if (!lectura.ok) return lectura.respuesta;
  // Cuenta solo los intentos bien formados: un 400 no consulta el padrón y
  // no le dice nada a nadie.
  const validacion = validarCredenciales(lectura.cuerpo);
  if (!validacion.ok) return respuestaError(validacion.error, 400);
  if (!cupo.intentar(kiosco.kiosco)) return respuestaError(ERROR_CUPO_ENTRADAS, 429);

  const entrada = await entrarCliente(validacion.datos, { ip: ipClienteDe(request) });
  if (!entrada.ok) return respuestaError(entrada.error, entrada.status);

  try {
    // Idempotente: si el aparato no tenía pedido en curso, no pasa nada.
    await cancelarBorrador(actorCapturaKiosco(kiosco), CANAL_KIOSCO, "Pedido descartado al entrar un cliente en el kiosco");
  } catch (error) {
    return respuestaDeError(error, "descartando el pedido del aparato al entrar un cliente", AREA_KIOSCO);
  }
  return respuestaOk({ ...entrada.sesion });
}
