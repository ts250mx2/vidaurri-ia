// Mensaje de bienvenida por WhatsApp al dar de alta un cliente en el padrón.
// Lo manda la pasarela de Axon Logic (POST /v1/public/customers/welcome): la
// plantilla del mensaje vive allá; aquí solo se envía el teléfono en formato
// internacional, el nombre y una clave de idempotencia para que un reintento
// no duplique el mensaje. Se pide uno por cada celular del cliente.
//
// Nunca lanza: el cliente ya quedó guardado cuando esto corre, y un fallo de
// la pasarela se reporta al usuario en el aviso de alta, no como error.

import type { ClienteDescuento } from "./clientes-descuento";
import { AxonError, configuracionAxon, MOTIVO_SIN_CONFIGURAR, peticionAxon } from "./axon";

export { MOTIVO_SIN_CONFIGURAR };

const RUTA_BIENVENIDA = "/v1/public/customers/welcome";
const LADA_MEXICO = "+52";
const DIGITOS_NACIONAL = 10;

export interface EnvioFallido {
  telefono: string;
  /** Para el usuario del panel: sin datos técnicos ni la API key. */
  motivo: string;
}

export interface ResultadoBienvenida {
  /** Celulares (nacional de 10 dígitos) cuyo mensaje aceptó Axon Logic. */
  enviados: string[];
  fallidos: EnvioFallido[];
}

/**
 * Teléfono canónico del padrón → E.164 para la pasarela: 10 dígitos son de
 * México ('8112345678' → '+528112345678'); más dígitos ya traen su país.
 */
export function telefonoE164(telefono: string): string | null {
  if (!/^\d{10,15}$/.test(telefono)) return null;
  return telefono.length === DIGITOS_NACIONAL ? `${LADA_MEXICO}${telefono}` : `+${telefono}`;
}

/** Una por cliente y celular: reintentar la misma alta no manda dos mensajes. */
export function claveIdempotencia(idCliente: number, telefono: string): string {
  return `cliente-${idCliente}-${telefono}`;
}

async function enviarUno(cliente: ClienteDescuento, telefono: string): Promise<EnvioFallido | null> {
  const phone = telefonoE164(telefono);
  if (!phone) return { telefono, motivo: "el celular no es un número válido" };

  const etiqueta = `Bienvenida WhatsApp al ${telefono} (cliente ${cliente.id})`;
  try {
    await peticionAxon(RUTA_BIENVENIDA, {
      method: "POST",
      body: {
        phone,
        name: cliente.cliente,
        idempotency_key: claveIdempotencia(cliente.id, telefono),
      },
      etiqueta,
    });
    return null;
  } catch (error) {
    if (error instanceof AxonError) return { telefono, motivo: error.motivo };
    console.error(`${etiqueta}: error inesperado`, error);
    return { telefono, motivo: "error inesperado al hablar con Axon Logic" };
  }
}

/**
 * Pide a Axon Logic la bienvenida para cada celular del cliente recién dado de
 * alta. Sin celulares no hay a quién mandarla (resultado vacío); sin API key
 * configurada todos quedan como fallidos con el motivo, para que se note.
 */
export async function enviarBienvenidaWhatsapp(
  cliente: ClienteDescuento
): Promise<ResultadoBienvenida> {
  const { telefonos } = cliente;
  if (telefonos.length === 0) return { enviados: [], fallidos: [] };

  if (!configuracionAxon()) {
    console.warn(`Bienvenida WhatsApp omitida (cliente ${cliente.id}): ${MOTIVO_SIN_CONFIGURAR}`);
    return {
      enviados: [],
      fallidos: telefonos.map((telefono) => ({ telefono, motivo: MOTIVO_SIN_CONFIGURAR })),
    };
  }

  const fallas = await Promise.all(telefonos.map((t) => enviarUno(cliente, t)));
  return {
    enviados: telefonos.filter((_, i) => fallas[i] === null),
    fallidos: fallas.filter((f): f is EnvioFallido => f !== null),
  };
}

/** '8112345678, 8187654321 y 8100000000' */
function listarTelefonos(telefonos: string[]): string {
  if (telefonos.length <= 1) return telefonos.join("");
  return `${telefonos.slice(0, -1).join(", ")} y ${telefonos[telefonos.length - 1]}`;
}

/** '8112345678 (motivo), 8187654321 (motivo)' */
function listarFallidos(fallidos: EnvioFallido[]): string {
  return fallidos.map((f) => `${f.telefono} (${f.motivo})`).join(", ");
}

export interface ResumenBienvenida {
  texto: string;
  conFallas: boolean;
}

/**
 * Cómo le fue a la bienvenida del alta, como frase para pegar tras "Se dio de
 * alta a X con N%". null si no había celulares: no hay nada que contar.
 */
export function resumenBienvenida(resultado: ResultadoBienvenida | undefined): ResumenBienvenida | null {
  if (!resultado || (resultado.enviados.length === 0 && resultado.fallidos.length === 0)) {
    return null;
  }
  const enviados = resultado.enviados.length
    ? ` y se le envió la bienvenida por WhatsApp al ${listarTelefonos(resultado.enviados)}`
    : "";
  if (resultado.fallidos.length === 0) return { texto: enviados, conFallas: false };

  const fallidos = listarFallidos(resultado.fallidos);
  const texto = enviados
    ? `${enviados}, pero no al ${fallidos}`
    : `, pero no se pudo enviar la bienvenida por WhatsApp al ${fallidos}`;
  return { texto, conFallas: true };
}

/**
 * Aviso del reenvío manual desde la lista: frase completa con el nombre del
 * cliente, porque aquí no hay un "Se dio de alta a…" que la preceda.
 */
export function resumenReenvio(nombre: string, resultado: ResultadoBienvenida): ResumenBienvenida {
  const { enviados, fallidos } = resultado;
  if (enviados.length === 0 && fallidos.length === 0) {
    return { texto: `${nombre} no tiene celular al que mandar la bienvenida`, conFallas: true };
  }
  const ok = enviados.length
    ? `Se reenvió la bienvenida por WhatsApp de ${nombre} al ${listarTelefonos(enviados)}`
    : "";
  if (fallidos.length === 0) return { texto: ok, conFallas: false };

  const texto = ok
    ? `${ok}, pero no al ${listarFallidos(fallidos)}`
    : `No se pudo reenviar la bienvenida de ${nombre} al ${listarFallidos(fallidos)}`;
  return { texto, conFallas: true };
}
