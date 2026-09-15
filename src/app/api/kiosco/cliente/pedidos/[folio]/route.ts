import { rutasKiosco } from "@/lib/autoservicio-rutas";

// El detalle de UN pedido del cliente que entró al kiosco: un folio ajeno es
// el mismo 404 que uno que no existe. El trabajo vive en
// autoservicio-rutas.ts (compartido con /api/clientes/pedidos/[folio]).

export const dynamic = "force-dynamic";

export const GET = rutasKiosco.pedido;
