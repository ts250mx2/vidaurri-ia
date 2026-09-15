import { rutasKiosco } from "@/lib/autoservicio-rutas";

// "Mis pedidos" del cliente que entró al kiosco con su celular. Exige la
// cabecera del cliente (401 con código cliente si falta). El trabajo vive en
// autoservicio-rutas.ts (compartido con /api/clientes/pedidos).

export const dynamic = "force-dynamic";

export const GET = rutasKiosco.pedidos;
