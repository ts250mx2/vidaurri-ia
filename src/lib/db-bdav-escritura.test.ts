import { describe, expect, it } from "vitest";
import {
  EscrituraNoPermitidaError,
  ejecutarTransaccionPos,
  validarSentenciaPos,
  type ConexionPos,
} from "./db-bdav-escritura";

const INSERT_COTIZA = `INSERT INTO cotiza (id_cte, num_cotiza, nombre, telefono, fecha_cot, subtotal, iva, total, observa, estatus)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'VIGENTE')`;
const INSERT_DETALLE = `INSERT INTO detalle_cotiza (id_cot, id_articulo, partida, cantidad, precio, total_partida)
   VALUES (?, ?, ?, ?, ?, ?)`;
const UPDATE_ESTATUS = "UPDATE cotiza SET estatus = ? WHERE id = ?";
const SELECT_NUM = "SELECT IFNULL(MAX(num_cotiza), 0) + 1 AS n FROM cotiza FOR UPDATE";

describe("validarSentenciaPos", () => {
  it("deja pasar exactamente las cuatro formas autorizadas", () => {
    expect(() => validarSentenciaPos(SELECT_NUM)).not.toThrow();
    expect(() => validarSentenciaPos("SELECT COUNT(*) AS c FROM cotiza WHERE num_cotiza = ?")).not.toThrow();
    expect(() => validarSentenciaPos(INSERT_COTIZA)).not.toThrow();
    expect(() => validarSentenciaPos(INSERT_DETALLE)).not.toThrow();
    expect(() => validarSentenciaPos(UPDATE_ESTATUS)).not.toThrow();
  });

  it("tolera saltos de línea y sangría de las plantillas multilínea", () => {
    expect(() =>
      validarSentenciaPos(`
        UPDATE cotiza
           SET estatus = ?
         WHERE id = ?
      `)
    ).not.toThrow();
  });

  it("rechaza cualquier otra escritura en bdav", () => {
    const prohibidas = [
      "DELETE FROM cotiza WHERE id = ?",
      "DELETE FROM detalle_cotiza WHERE id_cot = ?",
      "UPDATE cotiza SET total = ? WHERE id = ?",
      "UPDATE cotiza SET estatus = ?, total = ? WHERE id = ?",
      "UPDATE cotiza SET estatus = ? WHERE id = ? OR 1 = 1",
      "UPDATE cotiza SET estatus = ?",
      "UPDATE detalle_cotiza SET precio = ? WHERE id = ?",
      "UPDATE articulos SET existencia = 0",
      "INSERT INTO articulos (codigo) VALUES (?)",
      "INSERT INTO cotiza VALUES (?, ?)",
      "INSERT INTO cotiza_bak (id) VALUES (?)",
      "INSERT INTO detalle_cotiza_x (id) VALUES (?)",
      "REPLACE INTO cotiza (id) VALUES (?)",
      "TRUNCATE TABLE cotiza",
      "DROP TABLE cotiza",
      "ALTER TABLE cotiza ADD COLUMN x INT",
      "CREATE TABLE x (id INT)",
      "GRANT ALL ON bdav.* TO 'x'@'%'",
      "SET autocommit = 0",
      "CALL algo()",
      "",
    ];
    for (const sql of prohibidas) {
      expect(() => validarSentenciaPos(sql), sql).toThrow(EscrituraNoPermitidaError);
    }
  });

  it("es estricta con la forma canónica: minúsculas o espacios de más no pasan", () => {
    expect(() => validarSentenciaPos("insert into cotiza (id) VALUES (?)")).toThrow(EscrituraNoPermitidaError);
    expect(() => validarSentenciaPos("INSERT INTO cotiza(id) VALUES (?)")).toThrow(EscrituraNoPermitidaError);
    expect(() => validarSentenciaPos("update cotiza set estatus = ? where id = ?")).toThrow(EscrituraNoPermitidaError);
    expect(() => validarSentenciaPos("select 1")).toThrow(EscrituraNoPermitidaError);
  });

  it("no acepta sentencias apiladas ni comentarios que las escondan", () => {
    expect(() => validarSentenciaPos("SELECT 1; DELETE FROM cotiza")).toThrow(EscrituraNoPermitidaError);
    expect(() => validarSentenciaPos(`${UPDATE_ESTATUS}; DROP TABLE cotiza`)).toThrow(EscrituraNoPermitidaError);
    expect(() => validarSentenciaPos("/* x */ DELETE FROM cotiza")).toThrow(EscrituraNoPermitidaError);
    expect(() => validarSentenciaPos("-- x\nDELETE FROM cotiza")).toThrow(EscrituraNoPermitidaError);
  });

  it("un SELECT tampoco puede escribir a disco", () => {
    expect(() => validarSentenciaPos("SELECT * FROM cotiza INTO OUTFILE '/tmp/x'")).toThrow(/disco/);
    expect(() => validarSentenciaPos("SELECT 1 INTO DUMPFILE '/tmp/x'")).toThrow(/disco/);
  });

  it("el error trae la sentencia rechazada para el log", () => {
    try {
      validarSentenciaPos("DELETE FROM cotiza");
      expect.fail("debió lanzar");
    } catch (error) {
      expect(error).toBeInstanceOf(EscrituraNoPermitidaError);
      expect((error as EscrituraNoPermitidaError).sql).toBe("DELETE FROM cotiza");
    }
  });
});

/** Conexión falsa que anota lo que se le pide, para verificar la transacción sin base. */
function conexionFalsa(respuestas: unknown[] = []) {
  const bitacora: string[] = [];
  const enviadas: Array<{ sql: string; params: unknown[] | undefined }> = [];
  const conexion: ConexionPos = {
    async beginTransaction() {
      bitacora.push("begin");
    },
    async commit() {
      bitacora.push("commit");
    },
    async rollback() {
      bitacora.push("rollback");
    },
    async query(sql, params) {
      enviadas.push({ sql, params });
      return [respuestas.shift() ?? [], undefined];
    },
  };
  return { conexion, bitacora, enviadas };
}

describe("ejecutarTransaccionPos", () => {
  it("abre, ejecuta las sentencias permitidas y confirma", async () => {
    const { conexion, bitacora, enviadas } = conexionFalsa([[{ n: 5 }], { insertId: 77 }]);

    const resultado = await ejecutarTransaccionPos(conexion, async (ejecutar) => {
      const filas = (await ejecutar(SELECT_NUM)) as Array<{ n: number }>;
      const cabecera = (await ejecutar(INSERT_COTIZA, [1, filas[0].n])) as { insertId: number };
      return { n: filas[0].n, id: cabecera.insertId };
    });

    expect(resultado).toEqual({ n: 5, id: 77 });
    expect(bitacora).toEqual(["begin", "commit"]);
    expect(enviadas.map((e) => e.sql)).toEqual([SELECT_NUM, INSERT_COTIZA]);
    expect(enviadas[1].params).toEqual([1, 5]);
  });

  it("una sentencia fuera de la lista blanca NO se manda y deshace la transacción", async () => {
    const { conexion, bitacora, enviadas } = conexionFalsa([{ insertId: 1 }]);

    await expect(
      ejecutarTransaccionPos(conexion, async (ejecutar) => {
        await ejecutar(INSERT_COTIZA, []);
        await ejecutar("DELETE FROM cotiza WHERE id = ?", [1]);
      })
    ).rejects.toThrow(EscrituraNoPermitidaError);

    expect(bitacora).toEqual(["begin", "rollback"]);
    expect(enviadas.map((e) => e.sql)).toEqual([INSERT_COTIZA]);
  });

  it("un error del trabajo (choque de folio, por ejemplo) también deshace", async () => {
    const { conexion, bitacora } = conexionFalsa();

    await expect(
      ejecutarTransaccionPos(conexion, async () => {
        throw new Error("num_cotiza repetido");
      })
    ).rejects.toThrow("num_cotiza repetido");

    expect(bitacora).toEqual(["begin", "rollback"]);
  });
});
