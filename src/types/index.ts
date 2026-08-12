// Tipos compartidos del sistema Vidaurri IA.

/** Usuario de la sesión (contenido del JWT de la cookie). */
export interface SesionUsuario {
  id: number;
  usuario: string;
  nombre: string;
  perfil: "Administrador" | "Operaciones" | "Ventas" | string;
  nivel: number;
  serie: string | null;
}

/** Respuesta estándar de las API: éxito con datos o error con mensaje. */
export interface ApiRespuesta<T> {
  ok: boolean;
  datos?: T;
  error?: string;
}
