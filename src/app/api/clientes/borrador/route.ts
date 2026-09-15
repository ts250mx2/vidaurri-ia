import { rutasClientes } from "@/lib/autoservicio-rutas";

// El pedido en curso del CLIENTE (clave c:<celular>, la misma que usa
// WhatsApp: es el mismo cliente). GET lo lee; DELETE lo descarta. El trabajo
// vive en autoservicio-rutas.ts (compartido con /api/kiosco/borrador).

export const dynamic = "force-dynamic";

export const GET = rutasClientes.leerBorrador;
export const DELETE = rutasClientes.limpiarBorrador;
