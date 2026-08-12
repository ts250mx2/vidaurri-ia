import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { consultaBdav } from "@/lib/db";
import { firmarSesion, COOKIE_SESION } from "@/lib/auth";
import type { SesionUsuario } from "@/types";

export const dynamic = "force-dynamic";

const MAX_EDAD_COOKIE = 60 * 60 * 12; // 12 horas, igual que la expiración del JWT

interface FilaUsuario {
  id: number;
  usuario: string;
  nombre: string;
  perfil: string;
  nivel: number;
  serie: string | null;
}

export async function POST(request: Request) {
  let cuerpo: { usuario?: string; clave?: string };
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Petición inválida" }, { status: 400 });
  }

  const usuario = String(cuerpo.usuario ?? "").trim();
  const clave = String(cuerpo.clave ?? "");
  if (!usuario || !clave) {
    return NextResponse.json({ error: "Usuario y contraseña son obligatorios" }, { status: 400 });
  }

  try {
    // La tabla usuarios del POS guarda la clave en texto plano (sistema legacy).
    // La colación utf8mb3_general_ci es case-insensitive y PAD SPACE, así que
    // comparar la clave en SQL aceptaría mayúsculas distintas y espacios finales;
    // se trae la fila por usuario y se compara byte a byte en el servidor.
    const filas = await consultaBdav<FilaUsuario & { claveUsr: string }>(
      `SELECT id, usuario, clave_usr AS claveUsr, nombre, perfil, nivel, serie
         FROM usuarios
        WHERE usuario = ?
        LIMIT 1`,
      [usuario]
    );
    const fila = filas[0];
    if (!fila || fila.claveUsr !== clave) {
      return NextResponse.json({ error: "Credenciales inválidas" }, { status: 401 });
    }

    const sesion: SesionUsuario = {
      id: fila.id,
      usuario: fila.usuario,
      nombre: fila.nombre,
      perfil: fila.perfil,
      nivel: fila.nivel,
      serie: fila.serie,
    };
    const token = await firmarSesion(sesion);
    const jar = await cookies();
    jar.set(COOKIE_SESION, token, {
      httpOnly: true,
      secure: false, // despliegues internos por HTTP, igual que kyk-server-web
      sameSite: "lax",
      maxAge: MAX_EDAD_COOKIE,
      path: "/",
    });

    return NextResponse.json({ ok: true, usuario: sesion });
  } catch (error) {
    console.error("Error en login:", error);
    return NextResponse.json(
      { error: "No fue posible conectar a la base de datos" },
      { status: 502 }
    );
  }
}
