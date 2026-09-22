import { consultaBdav } from "@/lib/db";
import { consultaUsadas } from "@/lib/db-usadas";
import type { PartidaPedido } from "@/lib/pedidos";

// La foto de cada renglón de un pedido, para que la pantalla del mostrador
// (y el kiosco) enseñen la pieza y no solo su descripción. El pedido vive en
// BDVidaurriConversaciones y no guarda fotos: se resuelven al leerlo, de
// bdav para las nuevas (la columna `imagen` cuando está capturada, si no el
// código: hay artículos que comparten la foto de otro) y de la Bodega Usado
// para las usadas (la primera imagen activa de la pieza). Las dos bases son
// ajenas y pueden no contestar: aquí NUNCA se rompe un pedido por una foto.
// Si una consulta falla o tarda, esos renglones salen con `foto: null`, se
// loguea, y la pantalla pinta "foto por tomar".

/** Lo más que se espera a cada base: `leerDetalle` corre a veces dentro de una
 *  transacción y no conviene tener el pedido bloqueado por una foto. */
const ESPERA_MAX_MS = 3000;

type Fotos = Map<string, string>;

function conTope<T>(promesa: Promise<T>, respaldo: T, contexto: string): Promise<T> {
  let reloj: ReturnType<typeof setTimeout> | undefined;
  const espera = new Promise<T>((resolver) => {
    reloj = setTimeout(() => {
      console.error(`[pedidos] ${contexto}: sin respuesta en ${ESPERA_MAX_MS} ms; los renglones salen sin foto`);
      resolver(respaldo);
    }, ESPERA_MAX_MS);
  });
  return Promise.race([
    promesa.catch((error: unknown) => {
      console.error(`[pedidos] ${contexto}:`, error);
      return respaldo;
    }),
    espera,
  ]).finally(() => clearTimeout(reloj));
}

/** código (en mayúsculas) → nombre de archivo en el S3. */
async function fotosNuevas(codigos: string[]): Promise<Fotos> {
  const fotos: Fotos = new Map();
  if (codigos.length === 0) return fotos;
  const filas = await consultaBdav<{ codigo: string; imagen: string | null }>(
    `SELECT codigo, imagen FROM articulos WHERE codigo IN (?)`,
    [codigos]
  );
  for (const fila of filas) {
    const codigo = String(fila.codigo);
    const clave = codigo.toUpperCase();
    // Hay códigos capturados dos veces: con que uno traiga imagen basta.
    const imagen = String(fila.imagen ?? "").trim();
    if (imagen || !fotos.has(clave)) fotos.set(clave, imagen || codigo);
  }
  return fotos;
}

/** id_pieza (como texto) → nombre_imagen de su primera foto activa. */
async function fotosUsadas(ids: number[]): Promise<Fotos> {
  const fotos: Fotos = new Map();
  if (ids.length === 0) return fotos;
  const filas = await consultaUsadas<{ idPieza: number; nombre: string }>(
    `SELECT pi.id_pieza AS idPieza, pi.nombre_imagen AS nombre
       FROM piezas_imagenes pi
      WHERE pi.id_pieza IN (?) AND pi.activo = 1 AND pi.consecutivo >= 1
      ORDER BY pi.id_pieza, pi.consecutivo`,
    [ids]
  );
  for (const fila of filas) {
    const clave = String(fila.idPieza);
    if (!fotos.has(clave) && fila.nombre) fotos.set(clave, String(fila.nombre));
  }
  return fotos;
}

/** Los mismos renglones con su `foto` resuelta (null cuando no hay o la base no contestó). Devuelve copias. */
export async function conFotos(partidas: readonly PartidaPedido[]): Promise<PartidaPedido[]> {
  if (partidas.length === 0) return [];
  const codigos = [...new Set(partidas.flatMap((p) => (p.origen !== "usada" && p.codigo ? [p.codigo] : [])))];
  const ids = [...new Set(partidas.flatMap((p) => (p.origen === "usada" && p.idPiezaUsada ? [p.idPiezaUsada] : [])))];
  const vacio: Fotos = new Map();
  const [nuevas, usadas] = await Promise.all([
    conTope(fotosNuevas(codigos), vacio, "fotos de bdav para el pedido"),
    conTope(fotosUsadas(ids), vacio, "fotos de la Bodega Usado para el pedido"),
  ]);
  return partidas.map((p) => ({
    ...p,
    foto:
      p.origen === "usada"
        ? (p.idPiezaUsada !== null ? usadas.get(String(p.idPiezaUsada)) : undefined) ?? null
        : (p.codigo ? nuevas.get(p.codigo.toUpperCase()) : undefined) ?? null,
  }));
}
