import { rutasClientes } from "@/lib/autoservicio-rutas";

// Buscador del área de clientes: SIEMPRE con el descuento del cliente que
// entró (X-Cliente), y si la pieza está en tienda o va sobre pedido. El
// trabajo vive en autoservicio-rutas.ts (compartido con /api/kiosco/articulos).

export const dynamic = "force-dynamic";

export const GET = rutasClientes.articulos;
