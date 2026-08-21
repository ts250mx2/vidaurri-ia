import { describe, expect, it } from "vitest";
import { esTelefonoValido, normalizarTelefono, soloDigitos } from "./telefono";

describe("soloDigitos", () => {
  it("quita todo lo que no sea número", () => {
    expect(soloDigitos("+52 (81) 1234-5678")).toBe("528112345678");
    expect(soloDigitos("sin números")).toBe("");
  });
});

describe("normalizarTelefono", () => {
  it("quita la lada de México como la manda WhatsApp", () => {
    expect(normalizarTelefono("5218112345678")).toBe("8112345678");
    expect(normalizarTelefono("+5218112345678")).toBe("8112345678");
    expect(normalizarTelefono("+52 81 1234 5678")).toBe("8112345678");
    expect(normalizarTelefono("528112345678")).toBe("8112345678");
  });

  it("quita los prefijos viejos de larga distancia", () => {
    expect(normalizarTelefono("044 81 1234 5678")).toBe("8112345678");
    expect(normalizarTelefono("045-8112345678")).toBe("8112345678");
    expect(normalizarTelefono("01 81 1234 5678")).toBe("8112345678");
  });

  it("respeta números que ya son nacionales o de otro país", () => {
    expect(normalizarTelefono("81 1234 5678")).toBe("8112345678");
    expect(normalizarTelefono("8112345678")).toBe("8112345678");
    // Un número de EE.UU. no empieza con 52: se deja con su lada.
    expect(normalizarTelefono("+1 956 123 4567")).toBe("19561234567");
    // Un nacional que empieza con 52 (5212345678) NO pierde dígitos.
    expect(normalizarTelefono("5212345678")).toBe("5212345678");
  });

  it("no deja pasar basura muy larga", () => {
    expect(normalizarTelefono("1".repeat(40))).toHaveLength(20);
    expect(normalizarTelefono("")).toBe("");
  });
});

describe("esTelefonoValido", () => {
  it("acepta de 10 a 15 dígitos ya normalizados", () => {
    expect(esTelefonoValido("8112345678")).toBe(true);
    expect(esTelefonoValido("19561234567")).toBe(true);
    expect(esTelefonoValido("123456789012345")).toBe(true);
  });

  it("rechaza números cortos, vacíos o sin normalizar", () => {
    expect(esTelefonoValido("83749595")).toBe(false);
    expect(esTelefonoValido("")).toBe(false);
    expect(esTelefonoValido("81 1234 5678")).toBe(false);
    expect(esTelefonoValido("1234567890123456")).toBe(false);
  });
});
