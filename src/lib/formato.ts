// Formateo de números y fechas para toda la interfaz.

const fmtMoneda = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN",
  minimumFractionDigits: 2,
});

const fmtEntero = new Intl.NumberFormat("es-MX");

export function moneda(valor: number | string | null | undefined): string {
  const n = typeof valor === "string" ? parseFloat(valor) : valor;
  if (n == null || Number.isNaN(n)) return "$0.00";
  return fmtMoneda.format(n);
}

/** Tasa de IVA vigente en México. */
export const IVA = 0.16;

/** Agrega IVA a un precio base (sin IVA). */
export function conIva(base: number | string | null | undefined): number {
  const n = typeof base === "string" ? parseFloat(base) : base;
  if (n == null || Number.isNaN(n)) return 0;
  return n * (1 + IVA);
}

export function entero(valor: number | string | null | undefined): string {
  const n = typeof valor === "string" ? parseFloat(valor) : valor;
  if (n == null || Number.isNaN(n)) return "0";
  return fmtEntero.format(n);
}

/** 'AAAA-MM-DD' → 'DD/MM/AAAA' (las fechas llegan como string por dateStrings). */
export function fechaCorta(fecha: string | null | undefined): string {
  if (!fecha) return "";
  const [a, m, d] = fecha.slice(0, 10).split("-");
  if (!a || !m || !d) return fecha;
  return `${d}/${m}/${a}`;
}

/** Fecha de hoy en formato 'AAAA-MM-DD' (zona horaria local del servidor). */
export function hoyISO(): string {
  const hoy = new Date();
  const m = String(hoy.getMonth() + 1).padStart(2, "0");
  const d = String(hoy.getDate()).padStart(2, "0");
  return `${hoy.getFullYear()}-${m}-${d}`;
}
