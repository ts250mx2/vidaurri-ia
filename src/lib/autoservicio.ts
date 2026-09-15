import type { ClienteConCelular } from "@/lib/auth-clientes";
import type { SesionKiosco } from "@/lib/auth-kiosco";
import type { ClienteDescuento } from "@/lib/clientes-descuento";
import type { ActorCaptura, DatosBorrador } from "@/lib/db-pedidos";
import {
  AREA_KIOSCO,
  CANAL_KIOSCO,
  ERROR_CUPO_ENVIOS,
  LIMITE_ENVIOS_KIOSCO,
  LIMITE_VICO_KIOSCO,
  USUARIO_KIOSCO,
  actorCapturaKiosco,
  actorVicoKiosco,
  datosBorradorKiosco,
} from "@/lib/kiosco-api";
import { datosClienteParaEnvio } from "@/lib/kiosco-cliente";
import type { LimiteIntentos } from "@/lib/limite-intentos";
import { validarObservaciones, validarSucursal, type CanalPedido, type SucursalEntrega } from "@/lib/pedidos";
import type { ActorVendedor } from "@/lib/vendedor-pedidos";

// El "ámbito" del autoservicio: quién está armando el pedido y desde dónde.
// Las rutas /api/kiosco/* (el aparato del piso, con o sin cliente que entró)
// y /api/clientes/* (el cliente del padrón en su propio dispositivo) hacen
// EXACTAMENTE el mismo trabajo (autoservicio-rutas.ts); lo único que cambia
// sale de aquí, en funciones puras que prueban los tests:
//
//   | Aspecto   | Kiosco (aparato)            | Cliente (sin aparato)          |
//   |-----------|-----------------------------|--------------------------------|
//   | Borrador  | k:<kiosco>                  | c:<celular> (el de WhatsApp)   |
//   | Canal     | kiosco                      | web                            |
//   | Sucursal  | la del aparato              | la elige el cliente al enviar  |
//   | Precios   | mostrador, o del cliente    | siempre del cliente            |
//   | Enviar    | como siempre                | exige permitir_pedido (403)    |
//   | Vico      | actor kiosco                | actor cliente, canal web       |
//   | Topes     | por aparato                 | por cliente                    |

export type Ambito =
  | { tipo: "kiosco"; sesion: SesionKiosco; cliente: ClienteDescuento | null }
  | { tipo: "cliente"; cliente: ClienteConCelular };

/** El pedido del cliente desde la web nace en este canal (el literal, para que
 *  el actor cliente de Vico —que solo habla por WhatsApp o web— lo acepte). */
export const CANAL_CLIENTES = "web" satisfies CanalPedido;
/** Área con la que se firman los errores en el log del motor. */
export const AREA_CLIENTES = "clientes";
/** Usuario con el que se firman los eventos del pedido (mismo literal que la
 *  capa de datos usa para el actor cliente). */
export const USUARIO_CLIENTE = "cliente";
/** Dónde nace el borrador del cliente; la sucursal real la elige al enviar. */
export const SUCURSAL_CLIENTE_DEFAULT: SucursalEntrega = "matriz";

/** El pedido remoto sigue gateado por la bandera del padrón, como WhatsApp. */
export const ERROR_SIN_PERMISO_PEDIDO = "Pide en el mostrador que te activen los pedidos";

/** Mismos topes que el aparato: 20 envíos por hora y 20 mensajes por minuto. */
export const LIMITE_ENVIOS_CLIENTE: LimiteIntentos = LIMITE_ENVIOS_KIOSCO;
export const LIMITE_VICO_CLIENTE: LimiteIntentos = LIMITE_VICO_KIOSCO;
export const ERROR_CUPO_ENVIOS_CLIENTE = "Ya mandaste muchos pedidos en una hora; espera un momento o escríbenos por WhatsApp";

export const MENSAJE_VICO_MAX = 2000;

type Validacion<T> = { ok: true; datos: T } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Lo que cambia por ámbito.
// ---------------------------------------------------------------------------

/** Dueño del borrador: el APARATO en el kiosco; el cliente (c:<celular>, la
 *  misma clave que WhatsApp: es el mismo cliente y el mismo pedido) en el área. */
export function actorCapturaDe(ambito: Ambito): ActorCaptura {
  if (ambito.tipo === "kiosco") return actorCapturaKiosco(ambito.sesion);
  return { tipo: "cliente", telefono: ambito.cliente.telefono };
}

export function canalDe(ambito: Ambito): CanalPedido {
  return ambito.tipo === "kiosco" ? CANAL_KIOSCO : CANAL_CLIENTES;
}

export function areaDe(ambito: Ambito): string {
  return ambito.tipo === "kiosco" ? AREA_KIOSCO : AREA_CLIENTES;
}

export function usuarioDe(ambito: Ambito): string {
  return ambito.tipo === "kiosco" ? USUARIO_KIOSCO : USUARIO_CLIENTE;
}

/** El cliente del padrón detrás del ámbito; null = público general del kiosco. */
export function clienteDe(ambito: Ambito): ClienteDescuento | null {
  return ambito.cliente;
}

/** Con qué descuento se cotiza: null = precio de mostrador (solo el kiosco
 *  sin cliente); en el área de clientes SIEMPRE el del padrón. */
export function descuentoDe(ambito: Ambito): number | null {
  return ambito.cliente?.descuento ?? null;
}

/** Cabecera del borrador nuevo. La del kiosco es la de siempre; la del
 *  cliente nace en canal web, a su nombre, con su celular y su descuento. */
export function datosBorradorDe(ambito: Ambito): DatosBorrador {
  if (ambito.tipo === "kiosco") return datosBorradorKiosco(ambito.sesion, ambito.cliente);
  return {
    canal: CANAL_CLIENTES,
    idCliente: ambito.cliente.id,
    cliente: ambito.cliente.cliente,
    telefono: ambito.cliente.telefono,
    descuentoPct: ambito.cliente.descuento,
    sucursal: SUCURSAL_CLIENTE_DEFAULT,
  };
}

/** Con quién habla Vico: el aparato (con o sin cliente) o el actor cliente
 *  que ya existe para WhatsApp, en canal web. */
export function actorVicoDe(ambito: Ambito): ActorVendedor {
  if (ambito.tipo === "kiosco") return actorVicoKiosco(ambito.sesion, ambito.cliente);
  return {
    tipo: "cliente",
    idCliente: ambito.cliente.id,
    nombre: ambito.cliente.cliente,
    telefono: ambito.cliente.telefono,
    descuento: ambito.cliente.descuento,
    permitirPedido: ambito.cliente.permitirPedido,
    canal: CANAL_CLIENTES,
  };
}

/** Clave de los cupos: por aparato o por cliente. */
export function claveCupoDe(ambito: Ambito): string {
  return ambito.tipo === "kiosco" ? `k:${ambito.sesion.kiosco}` : `c:${ambito.cliente.id}`;
}

/** Clave de la memoria del chat con Vico. En el kiosco es la del aparato (y
 *  la de su bitácora). En el área es por cliente y, si la página manda una
 *  sesión, por sesión: dos dispositivos del mismo cliente no se mezclan. Nunca
 *  el número de WhatsApp: esa memoria es de otro canal. */
export function claveConversacionDe(ambito: Ambito, sesion: string | null): string {
  if (ambito.tipo === "kiosco") return `k:${ambito.sesion.kiosco}`;
  return sesion ? `w:${ambito.cliente.id}:${sesion}` : `w:${ambito.cliente.id}`;
}

/** Por qué no puede enviar, o null si puede. Solo el área de clientes exige
 *  permitir_pedido: en el kiosco el cliente está parado en la tienda. */
export function errorParaEnviar(ambito: Ambito): string | null {
  if (ambito.tipo === "cliente" && !ambito.cliente.permitirPedido) return ERROR_SIN_PERMISO_PEDIDO;
  return null;
}

/** Qué se le dice al pasarse del tope de envíos: en el kiosco, que pida ayuda
 *  al mostrador (está ahí); en el área, que espere o escriba por WhatsApp. */
export function errorCupoEnviosDe(ambito: Ambito): string {
  return ambito.tipo === "kiosco" ? ERROR_CUPO_ENVIOS : ERROR_CUPO_ENVIOS_CLIENTE;
}

export interface DatosEnvio {
  /** Con quién se sella el pedido antes de enviarlo (kiosco: lo tecleado o el
   *  padrón). null = el borrador ya nació con el cliente (área de clientes). */
  cliente: { cliente: string; telefono: string | null } | null;
  sucursal: SucursalEntrega;
  observaciones: string | null;
}

/**
 * Lo que hace falta para enviar, según el ámbito. Kiosco: nombre y celular
 * (tecleados, o del padrón si entró), sucursal del aparato, sin observaciones.
 * Cliente: elige la sucursal y puede dejar observaciones; nombre y celular ya
 * están en el borrador desde que nació.
 */
export function datosEnvioDe(ambito: Ambito, cuerpo: unknown): Validacion<DatosEnvio> {
  if (ambito.tipo === "kiosco") {
    const datos = datosClienteParaEnvio(ambito.cliente, cuerpo);
    if (!datos.ok) return datos;
    return { ok: true, datos: { cliente: datos.datos, sucursal: ambito.sesion.sucursal, observaciones: null } };
  }
  const envio = validarEnvioCliente(cuerpo);
  if (!envio.ok) return envio;
  return { ok: true, datos: { cliente: null, ...envio.datos } };
}

// ---------------------------------------------------------------------------
// Cuerpos (puros).
// ---------------------------------------------------------------------------

export interface EnvioCliente {
  sucursal: SucursalEntrega;
  observaciones: string | null;
}

/** `{ sucursal, observaciones? }` con que el cliente manda su pedido: la
 *  sucursal es obligatoria (aquí no hay aparato que la decida). */
export function validarEnvioCliente(entrada: unknown): Validacion<EnvioCliente> {
  const sucursal = validarSucursal(entrada);
  if (!sucursal.ok) return sucursal;
  const observaciones = validarObservaciones(entrada);
  if (!observaciones.ok) return observaciones;
  return { ok: true, datos: { sucursal: sucursal.datos.sucursal, observaciones: observaciones.datos.observaciones } };
}

export interface CuerpoVico {
  mensaje: string;
  reiniciar: boolean;
  /** Sesión de chat de la página (área de clientes), o null. */
  sesion: string | null;
}

const SESION_VALIDA = /^[a-z0-9-]{1,40}$/;

/** `{ mensaje, reiniciar?, sesion? }` del chat con Vico. */
export function validarCuerpoVico(entrada: unknown): Validacion<CuerpoVico> {
  if (typeof entrada !== "object" || entrada === null || Array.isArray(entrada)) {
    return { ok: false, error: "Petición inválida" };
  }
  const { mensaje, reiniciar, sesion } = entrada as Record<string, unknown>;
  const mensajeLimpio = typeof mensaje === "string" ? mensaje.trim().slice(0, MENSAJE_VICO_MAX) : "";
  if (!mensajeLimpio) return { ok: false, error: "Falta el mensaje" };
  let sesionLimpia: string | null = null;
  if (sesion != null && sesion !== "") {
    if (typeof sesion !== "string" || !SESION_VALIDA.test(sesion)) return { ok: false, error: "Petición inválida" };
    sesionLimpia = sesion;
  }
  return { ok: true, datos: { mensaje: mensajeLimpio, reiniciar: reiniciar === true, sesion: sesionLimpia } };
}
