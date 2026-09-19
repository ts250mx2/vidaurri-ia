// ¿El markdown de una respuesta trae al menos una tabla? Sirve para decidir si
// se ofrece el botón de Excel sin parsear el markdown completo en cada render:
// una tabla GFM siempre lleva una fila delimitadora hecha solo de barras,
// guiones y dos puntos ("|:---|--:|"). Sin dependencias a propósito: la página
// lo importa de forma estática y no debe arrastrar el parser.
//
// Es una heurística: puede decir que sí ante una "tabla" escrita dentro de un
// bloque de código. El parser de verdad decide al exportar (excel-respuesta.ts).

// Un solo guion basta ("| - |"): GFM no exige tres. La barra es obligatoria
// para no confundirla con una línea horizontal ("---"). El prefijo ">" cubre
// las tablas que van dentro de una cita ("> |---|---|"), también anidada.
const FILA_DELIMITADORA = /^(?:\s*>)*(?=.*\|)[\s|:-]*-[\s|:-]*$/m;

export function tieneTablas(markdown: string): boolean {
  return FILA_DELIMITADORA.test(markdown);
}
