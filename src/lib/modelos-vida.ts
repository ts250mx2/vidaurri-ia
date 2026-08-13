// Modelos que el usuario puede elegir para el agente VIDA (compartido entre la
// página del chat y el endpoint). Sin imports server-only para poder usarse en
// el cliente.

export interface ModeloOpcion {
  id: string;
  etiqueta: string;
}

export const MODELOS_VIDA: ModeloOpcion[] = [
  { id: "claude-opus-5", etiqueta: "Opus 5" },
  { id: "gpt-5.6-sol", etiqueta: "GPT-5.6 Sol" },
];

export function esModeloVidaValido(id: string): boolean {
  return MODELOS_VIDA.some((m) => m.id === id);
}
