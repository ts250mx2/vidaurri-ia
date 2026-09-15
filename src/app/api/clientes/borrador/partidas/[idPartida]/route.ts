import { rutasClientes } from "@/lib/autoservicio-rutas";

// Un renglón del pedido del cliente: PATCH cambia la cantidad, DELETE lo
// quita. El trabajo vive en autoservicio-rutas.ts (compartido con
// /api/kiosco/borrador/partidas/[idPartida]).

export const dynamic = "force-dynamic";

export const PATCH = rutasClientes.cambiarCantidad;
export const DELETE = rutasClientes.quitarPieza;
