import { rutasClientes } from "@/lib/autoservicio-rutas";

// Vico en el área de clientes: el actor 'cliente' (el mismo que por
// WhatsApp) en canal web, con su descuento del padrón y memoria propia por
// cliente y sesión de la página (body { mensaje, reiniciar?, sesion? }). El
// trabajo vive en autoservicio-vico.ts (compartido con /api/kiosco/vico).

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export const POST = rutasClientes.vico;
