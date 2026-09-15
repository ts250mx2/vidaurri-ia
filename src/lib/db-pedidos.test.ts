import { beforeEach, describe, expect, it, vi } from "vitest";

// La capa de datos se prueba con una conexión falsa que responde por la forma
// del SQL y guarda todo lo que se ejecuta: sin base de datos, pero comprobando
// lo que de verdad se escribe. Lo que importa aquí es la cantidad que va a
// Aldo (cantidad_aldo): quién la pone y dónde se borra.

const { registro } = vi.hoisted(() => ({
  registro: { consultas: [] as Array<{ sql: string; params: unknown[] }> },
}));

const CABECERA = {
  id: 41,
  estatus: "confirmado",
  canal: "mostrador",
  idCliente: null,
  cliente: "Público general",
  telefono: null,
  descuentoPct: 0,
  sucursal: "matriz",
  observaciones: null,
};

const PARTIDA = {
  id: 10,
  partida: 1,
  origen: "nueva",
  codigo: "FAC123",
  idPiezaUsada: null,
  descripcion: "Facia Versa",
  cantidad: 3,
  precioUnitario: 1088.08,
  importe: 3264.24,
  existenciaAlPedir: 1,
  estatusPartida: "sobre_pedido",
  diasEntrega: null,
  cantidadAldo: 2,
  nota: null,
};

const PEDIDO = {
  ...CABECERA,
  folio: "P-000041",
  subtotal: 2814,
  iva: 450.24,
  total: 3264.24,
  numPartidas: 1,
  idClienteBdav: null,
  capturadoPor: "ruben",
  atendidoPor: "ruben",
  numCotizaPos: null,
  cotizaPosEstado: "pendiente",
  cotizaPosError: null,
  numBkoPos: null,
  bkoPosEstado: "pendiente",
  bkoPosError: null,
  bkoPosCompromiso: null,
  folioVentaPos: null,
  motivoCancelacion: null,
  creadoEn: "2026-09-14 09:00:00",
  enviadoEn: null,
  confirmadoEn: null,
  listoEn: null,
  entregadoEn: null,
  canceladoEn: null,
  actualizadoEn: "2026-09-14 09:00:00",
};

/** Responde lo mínimo que espera cada consulta del módulo, por su forma. */
async function responder(sql: string, params: unknown[] = []): Promise<unknown[]> {
  registro.consultas.push({ sql, params });
  const s = sql.replace(/\s+/g, " ").trim();
  if (s.includes("FROM pedidos_mostrador WHERE id = ? FOR UPDATE")) return [[CABECERA]];
  if (s.includes("WHERE id = ? AND id_pedido = ? FOR UPDATE")) return [[PARTIDA]];
  if (s.includes("SELECT id, origen FROM pedidos_mostrador_partidas")) return [[{ id: 10, origen: "nueva" }]];
  if (s.includes("SELECT cantidad, precio_unitario")) return [[{ cantidad: 3, precioUnitario: 1088.08 }]];
  if (s.includes("FROM pedidos_mostrador p WHERE p.id = ?")) return [[PEDIDO]];
  if (s.includes("FROM pedidos_mostrador_partidas WHERE id_pedido = ? ORDER BY")) return [[PARTIDA]];
  if (s.includes("FROM pedidos_mostrador_eventos")) return [[]];
  if (/^(UPDATE|INSERT)/i.test(s)) return [{ affectedRows: 1, insertId: 99 }];
  return [[]];
}

vi.mock("@/lib/db-conversaciones", () => ({
  ahoraMonterrey: () => ({ fecha: "2026-09-14", momento: "2026-09-14 10:00:00" }),
  asegurarEsquema: async () => {},
  enTransaccion: async (trabajo: (conexion: { query: typeof responder }) => Promise<unknown>) =>
    trabajo({ query: responder }),
  poolConversaciones: () => ({ query: responder }),
}));

const { cambiarCantidadPartida, claveBorradorDe, confirmarPartidas, marcarSobrePedidoPorFaltante } =
  await import("./db-pedidos");

/** Las consultas ejecutadas, con los espacios normalizados para poder buscar. */
const ejecutadas = () => registro.consultas.map((c) => ({ sql: c.sql.replace(/\s+/g, " ").trim(), params: c.params }));

beforeEach(() => {
  registro.consultas = [];
});

describe("marcarSobrePedidoPorFaltante", () => {
  it("guarda en cada renglón las piezas que van a Aldo y solo toca los pendientes", async () => {
    const marcadas = await marcarSobrePedidoPorFaltante(
      41,
      [
        { partida: 1, cantidad: 2 },
        { partida: 3, cantidad: 1 },
      ],
      "ruben"
    );

    expect(marcadas).toBe(2);
    const marcas = ejecutadas().filter((c) => c.sql.includes("SET estatus_partida = 'sobre_pedido'"));
    expect(marcas).toHaveLength(2);
    expect(marcas[0].sql).toContain("cantidad_aldo = ?");
    expect(marcas[0].sql).toContain("estatus_partida = 'pendiente' AND origen <> 'usada'");
    expect(marcas[0].params).toEqual([2, "2026-09-14 10:00:00", 41, 1]);
    expect(marcas[1].params).toEqual([1, "2026-09-14 10:00:00", 41, 3]);
  });

  it("deja UN evento en la bitácora que dice por qué se pidieron", async () => {
    await marcarSobrePedidoPorFaltante(41, [{ partida: 1, cantidad: 2 }], "ruben");

    const eventos = ejecutadas().filter((c) => c.sql.startsWith("INSERT INTO pedidos_mostrador_eventos"));
    expect(eventos).toHaveLength(1);
    expect(eventos[0].params).toContain("sobre_pedido_automatico");
    expect(eventos[0].params).toContain("1 renglón sin existencia suficiente: 2 piezas van a back order con Aldo");
  });

  it("nunca escribe una cantidad inventada: sin faltante entero y positivo no toca el renglón", async () => {
    const marcadas = await marcarSobrePedidoPorFaltante(
      41,
      [
        { partida: 1, cantidad: 0 },
        { partida: 2, cantidad: -1 },
        { partida: 3, cantidad: 1.5 },
      ],
      null
    );

    expect(marcadas).toBe(0);
    expect(ejecutadas().some((c) => c.sql.startsWith("UPDATE"))).toBe(false);
    expect(ejecutadas().some((c) => c.sql.startsWith("INSERT"))).toBe(false);
  });

  it("sin renglones que marcar no abre transacción", async () => {
    expect(await marcarSobrePedidoPorFaltante(41, [], "ruben")).toBe(0);
    expect(registro.consultas).toHaveLength(0);
  });
});

describe("el mostrador retoma el mando: cantidad_aldo se borra", () => {
  it("al cambiar la cantidad del renglón", async () => {
    await cambiarCantidadPartida(41, 10, 5, "ruben", "mostrador");

    const cambio = ejecutadas().find((c) => c.sql.includes("SET cantidad = ?, importe = ?"));
    expect(cambio?.sql).toContain("cantidad_aldo = NULL");
    // Y al volver a pendiente (el pedido está confirmado) se borra otra vez.
    const vuelve = ejecutadas().find((c) => c.sql.includes("SET estatus_partida = 'pendiente'"));
    expect(vuelve?.sql).toContain("cantidad_aldo = NULL");
  });

  it("al confirmar los renglones a mano (un sobre pedido del mostrador va completo)", async () => {
    await confirmarPartidas(41, [{ id: 10, estatusPartida: "sobre_pedido", diasEntrega: 3, nota: null }], "ruben");

    const confirmacion = ejecutadas().find((c) => c.sql.includes("SET estatus_partida = ?"));
    expect(confirmacion?.sql).toContain("cantidad_aldo = NULL");
  });
});

describe("claveBorradorDe", () => {
  it("un borrador vivo por actor, con prefijo propio por tipo", () => {
    expect(claveBorradorDe({ tipo: "vendedor", usuario: "jperez" })).toBe("v:jperez");
    expect(claveBorradorDe({ tipo: "cliente", telefono: "8112345678" })).toBe("c:8112345678");
    expect(claveBorradorDe({ tipo: "kiosco", kiosco: "piso-1" })).toBe("k:piso-1");
  });

  it("el kiosco no puede colisionar con el borrador de un vendedor que se llame igual", () => {
    expect(claveBorradorDe({ tipo: "kiosco", kiosco: "jperez" })).not.toBe(
      claveBorradorDe({ tipo: "vendedor", usuario: "jperez" })
    );
  });
});
