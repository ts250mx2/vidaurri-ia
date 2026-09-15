import { rutasClientes } from "@/lib/autoservicio-rutas";

// "Mis pedidos" del cliente del área: sus últimos pedidos enviados, filtrados
// por el id del guardia, proyectados sin ids internos ni datos del POS. El
// trabajo vive en autoservicio-rutas.ts (compartido con
// /api/kiosco/cliente/pedidos).

export const dynamic = "force-dynamic";

export const GET = rutasClientes.pedidos;
