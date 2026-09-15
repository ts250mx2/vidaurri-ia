import { rutasKiosco } from "@/lib/autoservicio-rutas";

// Un renglón del pedido del kiosco: PATCH cambia la cantidad, DELETE lo
// quita. El trabajo vive en autoservicio-rutas.ts (compartido con
// /api/clientes/borrador/partidas/[idPartida]).

export const dynamic = "force-dynamic";

export const PATCH = rutasKiosco.cambiarCantidad;
export const DELETE = rutasKiosco.quitarPieza;
