import { NextResponse } from "next/server";
import { sesionActual } from "@/lib/auth";
import { buscarClienteBdavPorTelefono, type BusquedaClienteBdav } from "@/lib/clientes-bdav";
import { obtenerClienteDescuentoPorTelefono } from "@/lib/db-clientes-descuento";
import { descuentoPorDefecto } from "@/lib/descuento-default";
import { esTelefonoValido, normalizarTelefono } from "@/lib/telefono";

// Prellenado del formulario de clientes con descuento: dado un teléfono,
// dice si ya está en el padrón, lo busca en el catálogo de clientes de bdav
// (solo lectura) y propone nombre y descuento. Si el teléfono no está en el
// catálogo, el nombre va vacío y el descuento es el de DESCUENTO_DEFAULT.

export const dynamic = "force-dynamic";

type ResultadoCatalogo = BusquedaClienteBdav & { disponible: boolean };

async function consultarCatalogo(telefono: string): Promise<ResultadoCatalogo> {
  try {
    return { ...(await buscarClienteBdavPorTelefono(telefono)), disponible: true };
  } catch (error) {
    // bdav caído no debe impedir la captura: se avisa y se propone el default.
    console.error("No se pudo consultar el catálogo de clientes de bdav:", error);
    return { cliente: null, coincidencias: 0, disponible: false };
  }
}

export async function GET(request: Request) {
  const sesion = await sesionActual();
  if (!sesion) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const telefono = normalizarTelefono(searchParams.get("telefono") ?? "");
  if (!esTelefonoValido(telefono)) {
    return NextResponse.json({ error: "El teléfono debe tener 10 dígitos" }, { status: 400 });
  }

  try {
    const [registrado, catalogo] = await Promise.all([
      obtenerClienteDescuentoPorTelefono(telefono),
      consultarCatalogo(telefono),
    ]);
    const descuentoDefault = descuentoPorDefecto();
    const enBdav = catalogo.cliente;

    return NextResponse.json({
      telefono,
      registrado,
      enBdav,
      coincidencias: catalogo.coincidencias,
      catalogoNoDisponible: !catalogo.disponible,
      descuentoDefault,
      propuesta: {
        cliente: enBdav?.nombre ?? "",
        descuento: enBdav ? enBdav.descuento : descuentoDefault,
        idClienteBdav: enBdav?.id ?? null,
      },
    });
  } catch (error) {
    console.error("Error buscando el teléfono para clientes con descuento:", error);
    return NextResponse.json({ error: "No se pudo buscar el teléfono" }, { status: 502 });
  }
}
