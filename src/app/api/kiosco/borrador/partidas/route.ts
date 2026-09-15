import { rutasKiosco } from "@/lib/autoservicio-rutas";

// Agrega una pieza al pedido del kiosco (abre el borrador del aparato si no
// había). El trabajo vive en autoservicio-rutas.ts (compartido con
// /api/clientes/borrador/partidas).

export const dynamic = "force-dynamic";

export const POST = rutasKiosco.agregarPieza;
