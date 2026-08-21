import { afterEach, describe, expect, it } from "vitest";
import {
  DESCUENTO_RESPALDO,
  descuentoPorDefecto,
  esDescuentoValido,
  interpretarDescuentoDefault,
} from "./descuento-default";

describe("interpretarDescuentoDefault", () => {
  it("usa 33 cuando la variable no existe o está vacía", () => {
    expect(interpretarDescuentoDefault(undefined)).toBe(33);
    expect(interpretarDescuentoDefault(null)).toBe(33);
    expect(interpretarDescuentoDefault("")).toBe(33);
    expect(interpretarDescuentoDefault("   ")).toBe(33);
    expect(DESCUENTO_RESPALDO).toBe(33);
  });

  it("lee el valor configurado con o sin adornos", () => {
    expect(interpretarDescuentoDefault("38")).toBe(38);
    expect(interpretarDescuentoDefault("38%")).toBe(38);
    expect(interpretarDescuentoDefault(" 38 % ")).toBe(38);
    expect(interpretarDescuentoDefault("38.5")).toBe(38.5);
    expect(interpretarDescuentoDefault("38,5")).toBe(38.5);
    expect(interpretarDescuentoDefault("0")).toBe(0);
    expect(interpretarDescuentoDefault("100")).toBe(100);
  });

  it("redondea a dos decimales para que el formulario lo acepte", () => {
    expect(interpretarDescuentoDefault("38.333")).toBe(38.33);
    expect(interpretarDescuentoDefault("33,335")).toBe(33.34);
  });

  it("cae a 33 si el valor no es un porcentaje válido", () => {
    expect(interpretarDescuentoDefault("abc")).toBe(33);
    expect(interpretarDescuentoDefault("150")).toBe(33);
    expect(interpretarDescuentoDefault("-5")).toBe(33);
    expect(interpretarDescuentoDefault("38abc")).toBe(33);
    expect(interpretarDescuentoDefault("1e3")).toBe(33);
  });
});

describe("esDescuentoValido", () => {
  it("acepta números finitos de 0 a 100", () => {
    expect(esDescuentoValido(0)).toBe(true);
    expect(esDescuentoValido(38)).toBe(true);
    expect(esDescuentoValido(33.33)).toBe(true);
    expect(esDescuentoValido(100)).toBe(true);
  });

  it("rechaza fuera de rango, NaN, infinito y cadenas", () => {
    expect(esDescuentoValido(100.01)).toBe(false);
    expect(esDescuentoValido(-0.01)).toBe(false);
    expect(esDescuentoValido(Number.NaN)).toBe(false);
    expect(esDescuentoValido(Number.POSITIVE_INFINITY)).toBe(false);
    expect(esDescuentoValido("38")).toBe(false);
    expect(esDescuentoValido(null)).toBe(false);
  });
});

describe("descuentoPorDefecto", () => {
  const original = process.env.DESCUENTO_DEFAULT;
  afterEach(() => {
    if (original === undefined) delete process.env.DESCUENTO_DEFAULT;
    else process.env.DESCUENTO_DEFAULT = original;
  });

  it("lee DESCUENTO_DEFAULT del entorno", () => {
    process.env.DESCUENTO_DEFAULT = "38";
    expect(descuentoPorDefecto()).toBe(38);
  });

  it("sin variable de entorno devuelve 33", () => {
    delete process.env.DESCUENTO_DEFAULT;
    expect(descuentoPorDefecto()).toBe(33);
  });
});
