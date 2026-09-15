import { rutasClientes } from "@/lib/autoservicio-rutas";

// El cliente manda su pedido desde su dispositivo: body { sucursal,
// observaciones? }. Exige permitir_pedido del padrón (403 si no: el pedido
// remoto sigue gateado por esa bandera, como WhatsApp). Nace en 'enviado',
// canal web, y NO toca el POS. Responde solo { folio, piezas, total }. El
// trabajo vive en autoservicio-rutas.ts (compartido con
// /api/kiosco/borrador/enviar).

export const dynamic = "force-dynamic";

export const POST = rutasClientes.enviar;
