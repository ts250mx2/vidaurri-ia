// Descuento que se propone al dar de alta un cliente con descuento cuando el
// teléfono NO está en el catálogo de clientes de bdav. Se configura con
// DESCUENTO_DEFAULT en el .env (el negocio lo tiene en 38); si falta o trae
// un valor inválido, se usa 33: el descuento general que traen casi todos los
// clientes del punto de venta.

export const DESCUENTO_RESPALDO = 33;
export const DESCUENTO_MIN = 0;
export const DESCUENTO_MAX = 100;

/** Porcentaje válido: número finito entre 0 y 100. */
export function esDescuentoValido(valor: unknown): valor is number {
  return (
    typeof valor === "number" &&
    Number.isFinite(valor) &&
    valor >= DESCUENTO_MIN &&
    valor <= DESCUENTO_MAX
  );
}

/** Interpreta el valor crudo de la variable de entorno ('38', '38%', ' 38,5 ').
 *  Se redondea a dos decimales, como se guarda y como lo acepta el formulario. */
export function interpretarDescuentoDefault(valor: string | undefined | null): number {
  if (valor == null) return DESCUENTO_RESPALDO;
  const limpio = valor.trim().replace(/%$/, "").trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(limpio)) return DESCUENTO_RESPALDO;
  const numero = Math.round(Number(limpio) * 100) / 100;
  return esDescuentoValido(numero) ? numero : DESCUENTO_RESPALDO;
}

/** Descuento por defecto vigente según el .env del servidor. */
export function descuentoPorDefecto(): number {
  return interpretarDescuentoDefault(process.env.DESCUENTO_DEFAULT);
}
