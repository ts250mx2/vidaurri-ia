import { rutasKiosco } from "@/lib/autoservicio-rutas";

// El cliente toca "Enviar pedido": el pedido recibe folio y entra a la cola
// del mostrador con canal 'kiosco', en la sucursal del aparato; sin sesión
// de cliente teclea nombre y celular, con ella se usan los del padrón. El
// trabajo vive en autoservicio-rutas.ts (compartido con
// /api/clientes/borrador/enviar).

export const dynamic = "force-dynamic";

export const POST = rutasKiosco.enviar;
