import { rutasClientes } from "@/lib/autoservicio-rutas";

// El detalle de UN pedido del cliente: un folio ajeno es el mismo 404 que uno
// que no existe. El trabajo vive en autoservicio-rutas.ts (compartido con
// /api/kiosco/cliente/pedidos/[folio]).

export const dynamic = "force-dynamic";

export const GET = rutasClientes.pedido;
