import { rutasKiosco } from "@/lib/autoservicio-rutas";

// Buscador del kiosco de autoservicio: precio de MOSTRADOR o, si el cliente
// entró con su celular, el de su descuento del padrón; y si la pieza está en
// tienda o va sobre pedido. El trabajo vive en autoservicio-rutas.ts
// (compartido con /api/clientes/articulos).

export const dynamic = "force-dynamic";

export const GET = rutasKiosco.articulos;
