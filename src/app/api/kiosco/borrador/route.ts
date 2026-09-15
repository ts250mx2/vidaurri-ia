import { rutasKiosco } from "@/lib/autoservicio-rutas";

// El pedido en curso del APARATO (clave k:<kiosco>). GET lo lee; DELETE lo
// limpia cuando el cliente termina o la pantalla se cansa de esperarlo. El
// trabajo vive en autoservicio-rutas.ts (compartido con /api/clientes/borrador).

export const dynamic = "force-dynamic";

export const GET = rutasKiosco.leerBorrador;
export const DELETE = rutasKiosco.limpiarBorrador;
