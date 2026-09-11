import { describe, expect, it } from "vitest";
import { ordenarSugerencias, type CandidatoBdav } from "./sugerencias-bdav";

function candidato(id: number, nombre: string, extra: Partial<CandidatoBdav> = {}): CandidatoBdav {
  return { id, nombre, telefono: "", rfc: null, ciudad: null, descuento: 33, activo: 1, ...extra };
}

describe("ordenarSugerencias", () => {
  it("junta los repetidos, calcula el parecido y descarta los nombres lejanos sin motivo fuerte", () => {
    const sugerencias = ordenarSugerencias(
      [
        { candidato: candidato(10, "TALLER LOPEZ SA DE CV"), motivo: "nombre" },
        { candidato: candidato(10, "TALLER LOPEZ SA DE CV"), motivo: "celular" },
        { candidato: candidato(11, "CARROCERIAS MARTINEZ"), motivo: "nombre" },
        { candidato: candidato(12, "LOPEZ Y ASOCIADOS"), motivo: "nombre" },
      ],
      "Taller López"
    );
    expect(sugerencias.map((s) => s.id)).toEqual([10, 12]);
    expect(sugerencias[0].motivos).toEqual(["nombre", "celular"]);
    expect(sugerencias[0].similitud).toBe(100);
    expect(sugerencias[1].motivos).toEqual(["nombre"]);
  });

  it("RFC va antes que celular, y celular antes que solo el nombre, aunque el nombre no se parezca", () => {
    const sugerencias = ordenarSugerencias(
      [
        { candidato: candidato(1, "TALLER LOPEZ"), motivo: "nombre" },
        { candidato: candidato(2, "REFACCIONARIA EL SOL", { telefono: "8112345678" }), motivo: "celular" },
        { candidato: candidato(3, "OTRO NOMBRE", { rfc: "ABC850101XY1" }), motivo: "rfc" },
      ],
      "Taller López"
    );
    expect(sugerencias.map((s) => s.id)).toEqual([3, 2, 1]);
    expect(sugerencias[1].motivos).toEqual(["celular"]);
    expect(sugerencias[2].motivos).toEqual(["nombre"]);
  });

  it("con motivo fuerte y nombre parecido lleva los dos motivos", () => {
    const [unica] = ordenarSugerencias(
      [{ candidato: candidato(5, "JUAN PEREZ", { telefono: "8112345678" }), motivo: "celular" }],
      "Perez Juan"
    );
    expect(unica.motivos).toEqual(["celular", "nombre"]);
  });

  it("entre parecidos iguales van primero los activos, y se respeta el máximo", () => {
    const sugerencias = ordenarSugerencias(
      [
        { candidato: candidato(1, "TALLER LOPEZ", { activo: 0 }), motivo: "nombre" },
        { candidato: candidato(2, "TALLER LOPEZ", { activo: 1 }), motivo: "nombre" },
        { candidato: candidato(3, "TALLER LOPEZ NORTE"), motivo: "nombre" },
      ],
      "Taller López",
      { maximo: 2 }
    );
    expect(sugerencias.map((s) => s.id)).toEqual([2, 1]);
  });

  it("en búsqueda manual no se descarta nada por parecido", () => {
    const sugerencias = ordenarSugerencias(
      [{ candidato: candidato(9, "CARROCERIAS MARTINEZ"), motivo: "nombre" }],
      "Taller López",
      { soloParecidos: false }
    );
    expect(sugerencias.map((s) => s.id)).toEqual([9]);
    expect(sugerencias[0].similitud).toBeLessThan(40);
  });
});
