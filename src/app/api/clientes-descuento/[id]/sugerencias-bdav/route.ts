import { NextResponse } from "next/server";
import { sesionActual } from "@/lib/auth";
import { sugerirClientesBdav } from "@/lib/clientes-bdav";
import { leerIdRuta } from "@/lib/clientes-descuento";
import { obtenerClienteDescuento } from "@/lib/db-clientes-descuento";

const BUSQUEDA_MAX = 80;

// Con qué cliente del catálogo de bdav podría relacionarse un registro del
// padrón: candidatos por sus celulares, su RFC y las palabras de su nombre,
// ordenados por parecido. Con ?busqueda= el usuario busca a mano (nombre o
// teléfono). bdav se lee, nunca se escribe; si no responde, se avisa.

export const dynamic = "force-dynamic";

type Contexto = { params: Promise<{ id: string }> };

export async function GET(request: Request, contexto: Contexto) {
  const sesion = await sesionActual();
  if (!sesion) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const id = leerIdRuta((await contexto.params).id);
  if (id === null) return NextResponse.json({ error: "Identificador inválido" }, { status: 400 });
  const busqueda = (new URL(request.url).searchParams.get("busqueda") ?? "").trim().slice(0, BUSQUEDA_MAX);

  let registro;
  try {
    registro = await obtenerClienteDescuento(id);
  } catch (error) {
    console.error(`Error leyendo el cliente con descuento ${id}:`, error);
    return NextResponse.json({ error: "No se pudo consultar el padrón" }, { status: 502 });
  }
  if (!registro) return NextResponse.json({ error: "El registro ya no existe" }, { status: 404 });

  try {
    const sugerencias = await sugerirClientesBdav({
      nombre: registro.cliente,
      telefonos: registro.telefonos,
      rfc: registro.rfc,
      busqueda: busqueda || undefined,
    });
    return NextResponse.json({ sugerencias, catalogoNoDisponible: false });
  } catch (error) {
    console.error(`No se pudo consultar el catálogo de bdav para el cliente ${id}:`, error);
    return NextResponse.json({ sugerencias: [], catalogoNoDisponible: true });
  }
}
