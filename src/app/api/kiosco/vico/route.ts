import { rutasKiosco } from "@/lib/autoservicio-rutas";

// Vico en el kiosco de autoservicio, con el actor 'kiosco' (solo las tres
// herramientas de armar el pedido: mandarlo es el botón de la pantalla). El
// trabajo vive en autoservicio-vico.ts (compartido con /api/clientes/vico).

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export const POST = rutasKiosco.vico;
