import { NextResponse } from "next/server";
import { sesionActual } from "@/lib/auth";
import { idsBdavPorRfc } from "@/lib/clientes-bdav";
import { importarClientesDescuento } from "@/lib/db-clientes-descuento";
import {
  decodificarCsv,
  leerListaApv,
  type FilaImportacion,
  type LecturaLista,
} from "@/lib/importar-clientes-descuento";

// Importación de la lista de clientes APV (CSV) al padrón de clientes con
// descuento. Solo con sesión del panel: son datos reales de clientes. La lista
// entera entra en una sola transacción y se devuelve un resumen con todo lo
// que no entró o entró distinto, para que una persona lo revise.

export const dynamic = "force-dynamic";

const MAX_BYTES = 8 * 1024 * 1024;

/**
 * Liga cada fila con el catálogo de clientes de bdav por RFC (solo lectura),
 * cuando UN solo cliente de bdav tiene ese RFC. Si bdav no responde, la lista
 * se importa igual sin la liga: eso no es motivo para dejar el padrón vacío.
 */
async function ligarConBdav(filas: FilaImportacion[]): Promise<{ filas: FilaImportacion[]; ligados: number }> {
  try {
    const ids = await idsBdavPorRfc(filas.map((f) => f.rfc ?? ""));
    let ligados = 0;
    const ligadas = filas.map((f) => {
      const id = f.rfc ? ids.get(f.rfc) : undefined;
      if (id === undefined) return f;
      ligados++;
      return { ...f, idClienteBdav: id };
    });
    return { filas: ligadas, ligados };
  } catch (error) {
    console.error("No se pudo ligar la lista con el catálogo de bdav por RFC:", error);
    return { filas, ligados: 0 };
  }
}

export async function POST(request: Request) {
  const sesion = await sesionActual();
  if (!sesion) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  let archivo: FormDataEntryValue | null;
  try {
    archivo = (await request.formData()).get("archivo");
  } catch {
    return NextResponse.json({ error: "Petición inválida" }, { status: 400 });
  }
  if (!(archivo instanceof File)) {
    return NextResponse.json({ error: "Adjunta el archivo CSV de la lista" }, { status: 400 });
  }
  if (archivo.size > MAX_BYTES) {
    return NextResponse.json({ error: "El archivo no puede pasar de 8 MB" }, { status: 413 });
  }

  let lectura: LecturaLista;
  try {
    lectura = leerListaApv(decodificarCsv(new Uint8Array(await archivo.arrayBuffer())));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo leer el archivo" },
      { status: 400 }
    );
  }

  const { filas, ligados } = await ligarConBdav(lectura.filas);

  try {
    const resumen = await importarClientesDescuento(filas, sesion.usuario);
    return NextResponse.json({
      ...resumen,
      ligadosBdav: ligados,
      omitidas: lectura.omitidas,
      advertencias: lectura.advertencias,
    });
  } catch (error) {
    console.error("Error importando la lista de clientes con descuento:", error);
    return NextResponse.json(
      { error: "No se pudo importar la lista; no se guardó ningún registro" },
      { status: 502 }
    );
  }
}
