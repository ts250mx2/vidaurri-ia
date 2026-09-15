import { describe, expect, it } from "vitest";
import type { ClienteDescuento } from "./clientes-descuento";
import {
  ERROR_CREDENCIALES_CLIENTE,
  ERROR_PASSWORD_NUEVA_CELULAR,
  ERROR_PASSWORD_NUEVA_ESPACIOS,
  ERROR_PASSWORD_NUEVA_LARGO,
  PASSWORD_MAX,
  PASSWORD_NUEVA_MIN,
  clienteParaSesion,
  hashPassword,
  validarCambioPassword,
  validarCredenciales,
  validarNuevaPassword,
  verificarPassword,
} from "./clientes-acceso";

// La cuenta del cliente: entra con su celular y una contraseña que la primera
// vez es el mismo celular. Lo que aquí se cuida es que la contraseña jamás
// viva en claro (scrypt con sal), que verificar no truene con basura guardada
// y que las validaciones de los bordes digan por qué rechazan.

const CLIENTE: ClienteDescuento = {
  id: 4,
  telefono: "8112345678",
  telefonos: ["8112345678", "8187654321"],
  cliente: "Taller López",
  descuento: 38,
  rfc: "LOPJ800101XX1",
  telefono2: "83226730",
  email: "taller@lopez.mx",
  idClienteApv: 501,
  idClienteBdav: 77,
  permitirPedido: true,
  creadoPor: "jperez",
  creadoEn: "2026-09-01 10:00:00",
  actualizadoPor: null,
  actualizadoEn: "2026-09-01 10:00:00",
};

describe("hashPassword / verificarPassword", () => {
  it("guarda scrypt$<sal hex>$<hash hex>, nunca la contraseña en claro", async () => {
    const hash = await hashPassword("8112345678");

    const partes = hash.split("$");
    expect(partes).toHaveLength(3);
    expect(partes[0]).toBe("scrypt");
    expect(partes[1]).toMatch(/^[0-9a-f]{32}$/); // 16 bytes de sal
    expect(partes[2]).toMatch(/^[0-9a-f]{128}$/); // 64 bytes de hash
    expect(hash).not.toContain("8112345678");
  });

  it("la misma contraseña da hashes distintos (sal aleatoria) y los dos verifican", async () => {
    const a = await hashPassword("mi-clave-segura");
    const b = await hashPassword("mi-clave-segura");

    expect(a).not.toBe(b);
    await expect(verificarPassword("mi-clave-segura", a)).resolves.toBe(true);
    await expect(verificarPassword("mi-clave-segura", b)).resolves.toBe(true);
  });

  it("rechaza otra contraseña, aunque solo cambie una letra o el caso", async () => {
    const hash = await hashPassword("Taller2026");

    await expect(verificarPassword("taller2026", hash)).resolves.toBe(false);
    await expect(verificarPassword("Taller2026 ", hash)).resolves.toBe(false);
    await expect(verificarPassword("", hash)).resolves.toBe(false);
  });

  it("con un hash guardado de otro largo, malformado o vacío no truena: solo dice que no", async () => {
    await expect(verificarPassword("x", "scrypt$abcd$0011")).resolves.toBe(false);
    await expect(verificarPassword("x", "scrypt$zz$zz")).resolves.toBe(false);
    await expect(verificarPassword("x", "scrypt$$")).resolves.toBe(false);
    await expect(verificarPassword("x", "")).resolves.toBe(false);
    await expect(verificarPassword("x", "bcrypt$a$b")).resolves.toBe(false);
    await expect(verificarPassword("x", "sin-formato")).resolves.toBe(false);
  });
});

describe("validarCredenciales", () => {
  it("normaliza el usuario a celular de 10 dígitos y conserva la contraseña tal cual", () => {
    expect(validarCredenciales({ usuario: " +52 81 1234 5678 ", password: "8112345678" })).toEqual({
      ok: true,
      datos: { usuario: "8112345678", password: "8112345678" },
    });
    expect(validarCredenciales({ usuario: "044 8112345678", password: " con espacios " })).toEqual({
      ok: true,
      datos: { usuario: "8112345678", password: " con espacios " },
    });
  });

  it("rechaza usuarios que no quedan en 10 dígitos (las letras y signos se ignoran, como en todo el sistema)", () => {
    for (const malo of ["", "811234567", "81123456789012", "juan", "81123456789"]) {
      const r = validarCredenciales({ usuario: malo, password: "algo" });
      expect(r.ok, malo).toBe(false);
      if (!r.ok) expect(r.error).toBe(ERROR_CREDENCIALES_CLIENTE);
    }
  });

  it("rechaza contraseñas vacías, de más de 64 o que no son texto", () => {
    for (const mala of ["", "x".repeat(PASSWORD_MAX + 1), 123, null, undefined]) {
      const r = validarCredenciales({ usuario: "8112345678", password: mala });
      expect(r.ok, String(mala)).toBe(false);
    }
    expect(validarCredenciales({ usuario: "8112345678", password: "x".repeat(PASSWORD_MAX) }).ok).toBe(true);
  });

  it("rechaza cuerpos que no son objeto", () => {
    expect(validarCredenciales(null).ok).toBe(false);
    expect(validarCredenciales("8112345678").ok).toBe(false);
    expect(validarCredenciales([]).ok).toBe(false);
  });
});

describe("validarNuevaPassword", () => {
  it("acepta de 8 a 64 caracteres, distinta del celular", () => {
    expect(validarNuevaPassword("Taller2026", "8112345678")).toEqual({ ok: true, datos: { nueva: "Taller2026" } });
    expect(validarNuevaPassword("a".repeat(PASSWORD_NUEVA_MIN), "8112345678").ok).toBe(true);
    expect(validarNuevaPassword("a".repeat(PASSWORD_MAX), "8112345678").ok).toBe(true);
    expect(validarNuevaPassword("con espacio adentro", "8112345678").ok).toBe(true);
  });

  it("rechaza las cortas y las largas, con el motivo", () => {
    const corta = validarNuevaPassword("a".repeat(PASSWORD_NUEVA_MIN - 1), "8112345678");
    const larga = validarNuevaPassword("a".repeat(PASSWORD_MAX + 1), "8112345678");
    expect(corta).toEqual({ ok: false, error: ERROR_PASSWORD_NUEVA_LARGO });
    expect(larga).toEqual({ ok: false, error: ERROR_PASSWORD_NUEVA_LARGO });
  });

  it("rechaza espacios al inicio o al final (se pierden al teclear y luego no entra)", () => {
    expect(validarNuevaPassword(" Taller2026", "8112345678")).toEqual({ ok: false, error: ERROR_PASSWORD_NUEVA_ESPACIOS });
    expect(validarNuevaPassword("Taller2026 ", "8112345678")).toEqual({ ok: false, error: ERROR_PASSWORD_NUEVA_ESPACIOS });
  });

  it("rechaza que la nueva sea el celular (sería quedarse con la contraseña por defecto)", () => {
    expect(validarNuevaPassword("8112345678", "8112345678")).toEqual({ ok: false, error: ERROR_PASSWORD_NUEVA_CELULAR });
    // Con formato: '81 1234 5678' sigue siendo el celular.
    expect(validarNuevaPassword("81 1234 5678", "8112345678")).toEqual({ ok: false, error: ERROR_PASSWORD_NUEVA_CELULAR });
  });

  it("rechaza lo que no es texto", () => {
    expect(validarNuevaPassword(12345678, "8112345678").ok).toBe(false);
    expect(validarNuevaPassword(null, "8112345678").ok).toBe(false);
  });
});

describe("validarCambioPassword", () => {
  it("exige actual (1..64) y nueva válida", () => {
    expect(validarCambioPassword({ actual: "8112345678", nueva: "Taller2026" }, "8112345678")).toEqual({
      ok: true,
      datos: { actual: "8112345678", nueva: "Taller2026" },
    });
  });

  it("sin actual no valida nada más; con nueva mala devuelve su motivo", () => {
    expect(validarCambioPassword({ nueva: "Taller2026" }, "8112345678").ok).toBe(false);
    expect(validarCambioPassword({ actual: "", nueva: "Taller2026" }, "8112345678").ok).toBe(false);
    expect(validarCambioPassword({ actual: "8112345678", nueva: "corta" }, "8112345678")).toEqual({
      ok: false,
      error: ERROR_PASSWORD_NUEVA_LARGO,
    });
    expect(validarCambioPassword(null, "8112345678").ok).toBe(false);
  });
});

describe("clienteParaSesion", () => {
  it("es lo justo para saludar, cotizar y saber si puede pedir y si su contraseña sigue siendo el celular", () => {
    expect(clienteParaSesion(CLIENTE, "8187654321", true)).toEqual({
      idCliente: 4,
      nombre: "Taller López",
      telefono: "8187654321",
      descuento: 38,
      permitirPedido: true,
      passwordPorDefecto: true,
    });
  });

  it("no deja pasar el RFC, el correo, los otros celulares, la liga al POS ni nada del hash", () => {
    const crudo = JSON.stringify(clienteParaSesion(CLIENTE, "8112345678", false));

    for (const secreto of ["LOPJ800101XX1", "taller@lopez.mx", "8187654321", "83226730", "501", "77", "jperez", "hash", "scrypt"]) {
      expect(crudo, secreto).not.toContain(secreto);
    }
  });
});
