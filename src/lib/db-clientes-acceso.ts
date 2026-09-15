import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { hashPassword } from "@/lib/clientes-acceso";
import type { ClienteDescuento } from "@/lib/clientes-descuento";
import { ahoraMonterrey, asegurarEsquema, poolConversaciones } from "@/lib/db-conversaciones";

// Capa de datos de clientes_acceso (BDVidaurriConversaciones, esquema v9): la
// cuenta con la que el cliente del padrón entra al área de clientes. Aquí
// solo viajan hashes; la contraseña en claro se queda en clientes-entrar.ts
// el tiempo que tarda scrypt y nada más.

export interface ClienteAcceso {
  idCliente: number;
  /** Celular nacional con el que se creó la cuenta: su identidad. */
  telefono: string;
  /** Con qué entra; hoy es el mismo celular. */
  usuario: string;
  /** 'scrypt$sal$hash' (clientes-acceso.ts). */
  passwordHash: string;
  /** true = la contraseña sigue siendo el celular. */
  passwordPorDefecto: boolean;
  creadoEn: string;
  cambiadoEn: string | null;
  ultimoAcceso: string | null;
}

const COLUMNAS = `id_cliente AS idCliente, telefono, usuario, password_hash AS passwordHash,
       password_por_defecto AS passwordPorDefecto, creado_en AS creadoEn,
       cambiado_en AS cambiadoEn, ultimo_acceso AS ultimoAcceso`;

function aAcceso(fila: RowDataPacket): ClienteAcceso {
  return {
    idCliente: Number(fila.idCliente),
    telefono: String(fila.telefono),
    usuario: String(fila.usuario),
    passwordHash: String(fila.passwordHash),
    passwordPorDefecto: Number(fila.passwordPorDefecto) === 1,
    creadoEn: String(fila.creadoEn),
    cambiadoEn: fila.cambiadoEn == null ? null : String(fila.cambiadoEn),
    ultimoAcceso: fila.ultimoAcceso == null ? null : String(fila.ultimoAcceso),
  };
}

export async function obtenerAcceso(idCliente: number): Promise<ClienteAcceso | null> {
  await asegurarEsquema();
  const [filas] = await poolConversaciones().query<RowDataPacket[]>(
    `SELECT ${COLUMNAS} FROM clientes_acceso WHERE id_cliente = ?`,
    [idCliente]
  );
  return filas.length > 0 ? aAcceso(filas[0]) : null;
}

/**
 * La cuenta del primer acceso: usuario = celular con el que entró y contraseña
 * = ese mismo celular (con hash), marcada como por defecto. Si dos peticiones
 * llegan a la vez, la segunda no truena por la llave primaria: se queda con
 * la fila que ya creó la primera (es la misma cuenta).
 */
export async function crearAccesoPorDefecto(cliente: ClienteDescuento, telefono: string): Promise<ClienteAcceso> {
  await asegurarEsquema();
  const { momento } = ahoraMonterrey();
  const passwordHash = await hashPassword(telefono);
  await poolConversaciones().query<ResultSetHeader>(
    `INSERT INTO clientes_acceso
       (id_cliente, telefono, usuario, password_hash, password_por_defecto, creado_en)
     VALUES (?, ?, ?, ?, 1, ?)
     ON DUPLICATE KEY UPDATE id_cliente = id_cliente`,
    [cliente.id, telefono, telefono, passwordHash, momento]
  );
  const acceso = await obtenerAcceso(cliente.id);
  if (!acceso) throw new Error(`La cuenta del cliente #${cliente.id} no se pudo leer después de crearla`);
  return acceso;
}

/** Guarda el hash nuevo; desde aquí la contraseña ya no es la por defecto. */
export async function cambiarPassword(idCliente: number, passwordHash: string): Promise<void> {
  await asegurarEsquema();
  const { momento } = ahoraMonterrey();
  await poolConversaciones().query<ResultSetHeader>(
    `UPDATE clientes_acceso
        SET password_hash = ?, password_por_defecto = 0, cambiado_en = ?
      WHERE id_cliente = ?`,
    [passwordHash, momento, idCliente]
  );
}

/** Anota la hora del último acceso (solo informativo). */
export async function registrarAcceso(idCliente: number): Promise<void> {
  await asegurarEsquema();
  const { momento } = ahoraMonterrey();
  await poolConversaciones().query<ResultSetHeader>(
    `UPDATE clientes_acceso SET ultimo_acceso = ? WHERE id_cliente = ?`,
    [momento, idCliente]
  );
}
