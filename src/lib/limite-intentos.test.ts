import { describe, expect, it } from "vitest";
import {
  algunCuboExcede,
  CLAVE_SIN_IP,
  cubosDeLogin,
  excedeLimite,
  LIMITE_POR_IP,
  LIMITE_POR_USUARIO,
  LIMITE_SIN_IP,
  limpiarIntentos,
  podarIntentos,
  registrarEnCubos,
  registrarIntento,
  type RegistroIntentos,
} from "./limite-intentos";

const LIMITE = { maximo: 5, ventanaMs: 10 * 60 * 1000 };
const T0 = 1_000_000;

describe("límite de intentos", () => {
  it("permite hasta el máximo y bloquea el siguiente", () => {
    const registro: RegistroIntentos = new Map();
    for (let i = 0; i < 5; i++) {
      expect(excedeLimite(registro, "u:jperez", LIMITE, T0 + i)).toBe(false);
      registrarIntento(registro, "u:jperez", LIMITE, T0 + i);
    }
    expect(excedeLimite(registro, "u:jperez", LIMITE, T0 + 10)).toBe(true);
    expect(excedeLimite(registro, "u:otro", LIMITE, T0 + 10)).toBe(false);
  });

  it("los intentos vencen al salir de la ventana", () => {
    const registro: RegistroIntentos = new Map();
    for (let i = 0; i < 5; i++) registrarIntento(registro, "ip:1.2.3.4", LIMITE, T0);
    expect(excedeLimite(registro, "ip:1.2.3.4", LIMITE, T0 + LIMITE.ventanaMs - 1)).toBe(true);
    expect(excedeLimite(registro, "ip:1.2.3.4", LIMITE, T0 + LIMITE.ventanaMs)).toBe(false);
  });

  it("limpiar olvida la clave y podar quita solo las vencidas", () => {
    const registro: RegistroIntentos = new Map();
    registrarIntento(registro, "u:a", LIMITE, T0);
    registrarIntento(registro, "u:b", LIMITE, T0 + LIMITE.ventanaMs);
    limpiarIntentos(registro, "u:a");
    expect(registro.has("u:a")).toBe(false);

    registrarIntento(registro, "u:a", LIMITE, T0);
    podarIntentos(registro, LIMITE, T0 + LIMITE.ventanaMs + 1);
    expect(registro.has("u:a")).toBe(false);
    expect(registro.has("u:b")).toBe(true);
  });
});

describe("cubos del login", () => {
  it("con IP confiable cuenta por cuenta (en minúsculas) y por IP, 5 cada uno", () => {
    expect(cubosDeLogin("JPerez", "10.0.0.7")).toEqual([
      { clave: "u:jperez", limite: LIMITE_POR_USUARIO },
      { clave: "ip:10.0.0.7", limite: LIMITE_POR_IP },
    ]);
    expect(LIMITE_POR_USUARIO.maximo).toBe(5);
    expect(LIMITE_POR_IP.maximo).toBe(5);
  });

  it("sin IP usa el cubo compartido con tope alto en vez de un ip:local de 5", () => {
    expect(cubosDeLogin("jperez", null)).toEqual([
      { clave: "u:jperez", limite: LIMITE_POR_USUARIO },
      { clave: CLAVE_SIN_IP, limite: LIMITE_SIN_IP },
    ]);
    expect(LIMITE_SIN_IP.maximo).toBe(50);
    expect(LIMITE_SIN_IP.ventanaMs).toBe(LIMITE_POR_USUARIO.ventanaMs);
  });

  it("sin IP, 5 fallos de una cuenta no bloquean a un tercero", () => {
    const registro: RegistroIntentos = new Map();
    const atacada = cubosDeLogin("jperez", null);
    for (let i = 0; i < 5; i++) registrarEnCubos(registro, atacada, T0 + i);

    expect(algunCuboExcede(registro, atacada, T0 + 10)).toBe(true);
    expect(algunCuboExcede(registro, cubosDeLogin("mlopez", null), T0 + 10)).toBe(false);
  });

  it("sin IP, el rociado sobre muchas cuentas se frena en el cubo compartido", () => {
    const registro: RegistroIntentos = new Map();
    for (let i = 0; i < LIMITE_SIN_IP.maximo; i++) {
      const cubos = cubosDeLogin(`u${i}`, null);
      expect(algunCuboExcede(registro, cubos, T0 + i)).toBe(false);
      registrarEnCubos(registro, cubos, T0 + i);
    }
    expect(algunCuboExcede(registro, cubosDeLogin("u-nueva", null), T0 + 100)).toBe(true);
  });

  it("con IP, 5 fallos desde una IP bloquean esa IP y no a otra", () => {
    const registro: RegistroIntentos = new Map();
    for (let i = 0; i < 5; i++) registrarEnCubos(registro, cubosDeLogin(`u${i}`, "10.0.0.1"), T0 + i);
    expect(algunCuboExcede(registro, cubosDeLogin("u-nueva", "10.0.0.1"), T0 + 10)).toBe(true);
    expect(algunCuboExcede(registro, cubosDeLogin("u-nueva", "10.0.0.2"), T0 + 10)).toBe(false);
  });
});
