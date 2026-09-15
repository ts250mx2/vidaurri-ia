import { rutasClientes } from "@/lib/autoservicio-rutas";

// Agrega una pieza al pedido del cliente (abre su borrador, canal web, si no
// había), cotizada con su descuento del padrón. El trabajo vive en
// autoservicio-rutas.ts (compartido con /api/kiosco/borrador/partidas).

export const dynamic = "force-dynamic";

export const POST = rutasClientes.agregarPieza;
