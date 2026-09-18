import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { correrVendedor } from "./vendedor";
import { correrTurnoAgente, type CredencialIA } from "./agente-modelo";
import { consultaBdav } from "./db";
import { consultaUsadas } from "./db-usadas";
import { precioAldo } from "./aldo";

// Qué recibe Vico de buscar_productos cuando el proveedor (Aldo) no contesta.
// Va en archivo aparte de vendedor.test.ts para no depender de su arnés.
vi.mock("./agente-modelo", () => ({ correrTurnoAgente: vi.fn() }));
vi.mock("./db", () => ({ consultaBdav: vi.fn() }));
vi.mock("./db-usadas", () => ({ consultaUsadas: vi.fn() }));
vi.mock("./aldo", () => ({ precioAldo: vi.fn() }));

const CREDENCIAL: CredencialIA = {
  proveedor: "claude",
  modelo: "claude-test",
  baseURL: "http://hl/api/ws/proxy/prueba",
  headers: {},
};

const FILA = {
  codigo: "CNVE15",
  descripcion: "COFRE VERSA 15-19",
  marca: "NISSAN",
  tipoParte: "COFRE",
  aini: 2015,
  afin: 2019,
  precioSinIva: 1474,
  precioConIva: 1709.84,
  existencia: 0,
  localizacion: null,
};

interface ResultadoBusqueda {
  total: number;
  resultados: Array<{ codigo: string; sobrePedido: number | string | null }>;
  nota?: string;
}

/** Corre un turno con una búsqueda y devuelve el JSON que la herramienta le entregó al modelo. */
async function buscarComoVico(): Promise<ResultadoBusqueda> {
  vi.mocked(consultaBdav).mockResolvedValue([FILA]);
  vi.mocked(consultaUsadas).mockResolvedValue([]);
  vi.mocked(correrTurnoAgente)
    .mockResolvedValueOnce({
      contenido: [],
      usos: [{ id: "t1", name: "buscar_productos", input: { descripcion: "cofre versa" } }],
    })
    .mockResolvedValueOnce({ contenido: [], usos: [] });

  await correrVendedor({ pregunta: "cofre versa 2015", historial: [], credencial: CREDENCIAL });

  const mensajes = vi.mocked(correrTurnoAgente).mock.calls[1][0].mensajes;
  const bloques = mensajes.flatMap((m) => (typeof m.content === "string" ? [] : m.content));
  const entregado = bloques.find((b): b is Anthropic.ToolResultBlockParam => b.type === "tool_result");
  return JSON.parse(String(entregado?.content)) as ResultadoBusqueda;
}

afterEach(() => {
  vi.resetAllMocks();
});

describe("buscar_productos cuando el proveedor no contesta", () => {
  it("la disponibilidad sobre pedido va como desconocida (null) y con un aviso para no negar la pieza", async () => {
    vi.mocked(precioAldo).mockResolvedValue({ encontrado: false, sinRespuesta: true });

    const entregado = await buscarComoVico();

    expect(entregado.resultados[0]).toMatchObject({ codigo: "CNVE15", sobrePedido: null });
    expect(entregado.nota).toContain("no se pudo consultar");
    expect(entregado.nota).toContain("NO digas que no se consiguen");
  });

  it("si el proveedor SÍ contestó que no la tiene, va en 0 y sin aviso: ahí sí es que no hay", async () => {
    vi.mocked(precioAldo).mockResolvedValue({ encontrado: false });

    const entregado = await buscarComoVico();

    expect(entregado.resultados[0]).toMatchObject({ codigo: "CNVE15", sobrePedido: 0 });
    expect(entregado.nota).toBeUndefined();
  });

  it("con existencia en el proveedor, sobrePedido lleva esa existencia", async () => {
    vi.mocked(precioAldo).mockResolvedValue({ encontrado: true, existencia: "Mas de 60" });

    const entregado = await buscarComoVico();

    expect(entregado.resultados[0].sobrePedido).toBe("Mas de 60");
    expect(entregado.nota).toBeUndefined();
  });
});
