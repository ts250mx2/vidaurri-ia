import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { COOKIE_SESION } from "@/lib/auth";

// El middleware corre en Edge: verifica el JWT directamente con jose.
// Si falta JWT_SECRET, encodear "" haría que toda verificación fallara en
// silencio (todos al login); mejor un secreto imposible que deja rastro claro.
const SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "__vidaurri_sin_jwt_secret__"
);

export async function middleware(request: NextRequest) {
  const sesion = request.cookies.get(COOKIE_SESION);
  const { pathname } = request.nextUrl;

  // Login y APIs quedan fuera de la protección general: cada API valida su
  // propia sesión y responde 401 (evita redirecciones HTML en fetch).
  if (pathname === "/login" || pathname.startsWith("/api")) {
    if (sesion && pathname === "/login") {
      try {
        await jwtVerify(sesion.value, SECRET);
        return NextResponse.redirect(new URL("/dashboard", request.url));
      } catch {
        // token inválido: se queda en /login
      }
    }
    return NextResponse.next();
  }

  if (!sesion) return NextResponse.redirect(new URL("/login", request.url));
  try {
    await jwtVerify(sesion.value, SECRET);
    return NextResponse.next();
  } catch {
    return NextResponse.redirect(new URL("/login", request.url));
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
