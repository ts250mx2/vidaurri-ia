import { describe, expect, it } from "vitest";
import { normalizarNombre, similitudNombres, tokensNombre, tokensParaBuscar } from "./similitud-nombres";

describe("normalizarNombre y tokens", () => {
  it("quita acentos, puntuación y mayúsculas", () => {
    expect(normalizarNombre("  Taller  López, S.A. de C.V. ")).toBe("TALLER LOPEZ S A DE C V");
    expect(normalizarNombre("Ñoño & Cía.")).toBe("NONO CIA");
  });

  it("los tokens omiten partículas y siglas de razón social, sin repetir", () => {
    expect(tokensNombre("Taller López, S.A. de C.V.")).toEqual(["TALLER", "LOPEZ"]);
    expect(tokensNombre("Refacciones del Norte y del Sur SA de CV")).toEqual(["REFACCIONES", "NORTE", "SUR"]);
    expect(tokensNombre("LOPEZ LOPEZ JUAN")).toEqual(["LOPEZ", "JUAN"]);
  });

  it("para buscar se usan las palabras más largas, hasta tres, de al menos tres letras", () => {
    expect(tokensParaBuscar("Servicio Automotriz Ruiz y Cia de RL")).toEqual(["AUTOMOTRIZ", "SERVICIO", "RUIZ"]);
    expect(tokensParaBuscar("Juan Pérez")).toEqual(["PEREZ", "JUAN"]);
    expect(tokensParaBuscar("SA de CV")).toEqual([]);
  });
});

describe("similitudNombres", () => {
  it("el mismo nombre normalizado es 100 y nombres vacíos son 0", () => {
    expect(similitudNombres("Taller López", "TALLER LOPEZ")).toBe(100);
    expect(similitudNombres("Taller López S.A. de C.V.", "TALLER LOPEZ SA DE CV")).toBe(100);
    expect(similitudNombres("", "TALLER LOPEZ")).toBe(0);
  });

  it("tolera razón social de más, orden distinto y abreviaturas", () => {
    expect(similitudNombres("Taller López", "TALLER LOPEZ Y ASOCIADOS SA DE CV")).toBeGreaterThanOrEqual(80);
    expect(similitudNombres("Lopez Taller Mecanico", "TALLER MECANICO LOPEZ")).toBeGreaterThanOrEqual(95);
    expect(similitudNombres("Juan Ruben Hernandez Gonzalez", "HERNANDEZ GONZALEZ JUAN RUBEN")).toBeGreaterThanOrEqual(
      95
    );
    expect(similitudNombres("Refaccionaria Garcia", "REFACC GARCIA")).toBeGreaterThanOrEqual(55);
  });

  it("nombres distintos quedan bajos", () => {
    expect(similitudNombres("Taller López", "CARROCERIAS MARTINEZ")).toBeLessThan(30);
    expect(similitudNombres("TIGRE", "ARMONIA MECANICA")).toBeLessThan(20);
  });

  it("un apellido en común no basta para parecerse mucho", () => {
    expect(similitudNombres("Juan Hernandez", "Pedro Hernandez Lopez")).toBeLessThan(70);
  });
});
