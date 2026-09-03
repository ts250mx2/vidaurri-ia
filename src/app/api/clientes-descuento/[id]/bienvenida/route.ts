import { NextResponse } from "next/server";
import { sesionActual } from "@/lib/auth";
import { leerIdRuta, type ClienteDescuento } from "@/lib/clientes-descuento";
import { obtenerClienteDescuento } from "@/lib/db-clientes-descuento";
import { enviarBienvenidaWhatsapp } from "@/lib/whatsapp-bienvenida";

// Reenvío manual de la bienvenida por WhatsApp (botón de la lista del padrón):
// para los clientes dados de alta mientras Axon Logic fallaba, o a los que se
// les agregó un celular después. Usa la misma clave de idempotencia que el
// alta, así que a quien Axon Logic ya le mandó el mensaje no se lo repite.

export const dynamic = "force-dynamic";

type Contexto = { params: Promise<{ id: string }> };

export async function POST(_request: Request, contexto: Contexto) {
  const sesion = await sesionActual();
  if (!sesion) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const id = leerIdRuta((await contexto.params).id);
  if (id == null) return NextResponse.json({ error: "Identificador inválido" }, { status: 400 });

  let registro: ClienteDescuento | null;
  try {
    registro = await obtenerClienteDescuento(id);
  } catch (error) {
    console.error(`Error leyendo el cliente con descuento ${id} para reenviar la bienvenida:`, error);
    return NextResponse.json(
      { error: "No se pudo consultar el padrón de clientes con descuento" },
      { status: 502 }
    );
  }
  if (!registro) return NextResponse.json({ error: "El registro ya no existe" }, { status: 404 });
  if (registro.telefonos.length === 0) {
    return NextResponse.json(
      { error: `${registro.cliente} no tiene celular al que mandar la bienvenida` },
      { status: 400 }
    );
  }

  const bienvenida = await enviarBienvenidaWhatsapp(registro);
  return NextResponse.json({ registro, bienvenida });
}
