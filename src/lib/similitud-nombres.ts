// Parecido entre nombres de clientes (padrón vs catálogo de bdav), para
// sugerir con qué cliente del catálogo relacionar uno del padrón. Lógica
// pura: normaliza (mayúsculas, sin acentos ni puntuación, sin partículas ni
// siglas de razón social) y combina dos medidas: bigramas de Dice sobre el
// texto completo y traslape de palabras. Así "TALLER LOPEZ" se parece tanto a
// "TALLER LOPEZ SA DE CV" como a "LOPEZ TALLER MECANICO".

/** Partículas y siglas que no distinguen a un cliente de otro. */
const PALABRAS_VACIAS = new Set([
  "DE", "DEL", "LA", "LAS", "LOS", "EL", "Y", "E", "A", "EN",
  "SA", "CV", "RL", "SC", "SAPI", "SRL", "SAS", "SOFOM", "ENR", "S", "C", "V",
]);
/** Palabras más cortas que esto no sirven para buscar en el catálogo. */
const LARGO_MINIMO_BUSQUEDA = 3;
const TOKENS_BUSQUEDA_MAX = 3;
const PRIMER_DIACRITICO = 0x300;
const ULTIMO_DIACRITICO = 0x36f;

/** 'Taller  López, S.A. de C.V.' → 'TALLER LOPEZ S A DE C V' (la Ñ queda como N: para comparar sirve igual). */
export function normalizarNombre(texto: string): string {
  return Array.from(texto.normalize("NFD"))
    .filter((c) => {
      const codigo = c.charCodeAt(0);
      return codigo < PRIMER_DIACRITICO || codigo > ULTIMO_DIACRITICO;
    })
    .join("")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Palabras significativas, únicas y en su orden: sin partículas ni siglas. */
export function tokensNombre(texto: string): string[] {
  const vistos = new Set<string>();
  const tokens: string[] = [];
  for (const palabra of normalizarNombre(texto).split(" ")) {
    if (!palabra || PALABRAS_VACIAS.has(palabra) || vistos.has(palabra)) continue;
    vistos.add(palabra);
    tokens.push(palabra);
  }
  return tokens;
}

/** Las palabras con las que vale la pena buscar en el catálogo: las más largas primero. */
export function tokensParaBuscar(texto: string, maximo = TOKENS_BUSQUEDA_MAX): string[] {
  return tokensNombre(texto)
    .filter((t) => t.length >= LARGO_MINIMO_BUSQUEDA)
    .sort((a, b) => b.length - a.length || a.localeCompare(b))
    .slice(0, maximo);
}

function bigramas(texto: string): Map<string, number> {
  const conteo = new Map<string, number>();
  const compacto = texto.replace(/ /g, "");
  for (let i = 0; i + 1 < compacto.length; i++) {
    const par = compacto.slice(i, i + 2);
    conteo.set(par, (conteo.get(par) ?? 0) + 1);
  }
  return conteo;
}

/** Coeficiente de Dice sobre bigramas de letras (0-1). */
function dice(a: string, b: string): number {
  const ba = bigramas(a);
  const bb = bigramas(b);
  let totalA = 0;
  let totalB = 0;
  let comunes = 0;
  for (const n of ba.values()) totalA += n;
  for (const n of bb.values()) totalB += n;
  if (totalA + totalB === 0) return 0;
  for (const [par, n] of ba) comunes += Math.min(n, bb.get(par) ?? 0);
  return (2 * comunes) / (totalA + totalB);
}

/** Palabras en común sobre las del nombre más corto (0-1): "TALLER LOPEZ" ⊂ "TALLER LOPEZ Y ASOCIADOS" = 1. */
function traslapeTokens(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const conjunto = new Set(b);
  const comunes = a.filter((t) => conjunto.has(t)).length;
  return comunes / Math.min(a.length, b.length);
}

/**
 * 0 a 100: 100 = mismo nombre normalizado. Mitad Dice sobre el texto entero
 * (tolera abreviaturas y letras cambiadas), mitad traslape de palabras
 * (tolera orden distinto y razón social de más).
 */
export function similitudNombres(a: string, b: string): number {
  const na = normalizarNombre(a);
  const nb = normalizarNombre(b);
  if (!na || !nb) return 0;
  if (na === nb) return 100;
  const ta = tokensNombre(a);
  const tb = tokensNombre(b);
  const texto = dice(ta.join(" ") || na, tb.join(" ") || nb);
  const palabras = traslapeTokens(ta, tb);
  return Math.round(100 * (0.5 * texto + 0.5 * palabras));
}
