import { NextResponse } from "next/server";
import { sesionActual } from "@/lib/auth";
import { validarCapturaClienteDescuento, type FiltroCelular } from "@/lib/clientes-descuento";
import {
  crearClienteDescuento,
  listarClientesDescuento,
  ReferenciaApvDuplicadaError,
  TelefonoDuplicadoError,
} from "@/lib/db-clientes-descuento";
import { descuentoPorDefecto } from "@/lib/descuento-default";
import { enviarBienvenidaWhatsapp } from "@/lib/whatsapp-bienvenida";

// Padrón de clientes con descuento del Vendedor IA (BDVidaurriConversaciones).
// Solo con sesión del panel: son teléfonos y nombres reales de clientes.
// Al dar de alta se le manda la bienvenida por WhatsApp (Axon Logic) a cada
// celular; cómo le fue va en la respuesta, para el aviso del padrón.

export const dynamic = "force-dynamic";

const POR_PAGINA = 50;
const PAGINA_MAX = 10000;
const BUSQUEDA_MAX = 80;

export async function GET(request: Request) {
  const sesion = await sesionActual();
  if (!sesion) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const busqueda = (searchParams.get("busqueda") ?? "").trim().slice(0, BUSQUEDA_MAX);
  const celularCrudo = searchParams.get("celular");
  const celular: FiltroCelular | undefined =
    celularCrudo === "con" || celularCrudo === "sin" ? celularCrudo : undefined;
  const pagina = Math.min(
    PAGINA_MAX,
    Math.max(1, Number.parseInt(searchParams.get("pagina") ?? "1", 10) || 1)
  );

  try {
    const datos = await listarClientesDescuento({
      busqueda,
      celular,
      pagina,
      porPagina: POR_PAGINA,
    });
    return NextResponse.json({
      ...datos,
      porPagina: POR_PAGINA,
      descuentoDefault: descuentoPorDefecto(),
    });
  } catch (error) {
    console.error("Error listando clientes con descuento:", error);
    return NextResponse.json(
      { error: "No se pudo consultar el padrón de clientes con descuento" },
      { status: 502 }
    );
  }
}

export async function POST(request: Request) {
  const sesion = await sesionActual();
  if (!sesion) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  let cuerpo: unknown;
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Petición inválida" }, { status: 400 });
  }
  const validacion = validarCapturaClienteDescuento(cuerpo);
  if (!validacion.ok) return NextResponse.json({ error: validacion.error }, { status: 400 });

  try {
    const registro = await crearClienteDescuento(validacion.datos, sesion.usuario);
    // El cliente ya quedó guardado: si la bienvenida falla se informa, no se deshace.
    const bienvenida = await enviarBienvenidaWhatsapp(registro);
    return NextResponse.json({ registro, bienvenida }, { status: 201 });
  } catch (error) {
    if (error instanceof TelefonoDuplicadoError) {
      return NextResponse.json(
        { error: error.message, telefono: error.telefono, existente: error.existente },
        { status: 409 }
      );
    }
    if (error instanceof ReferenciaApvDuplicadaError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("Error dando de alta un cliente con descuento:", error);
    return NextResponse.json(
      { error: "No se pudo guardar el cliente con descuento" },
      { status: 502 }
    );
  }
}
