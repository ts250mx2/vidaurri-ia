import { describe, expect, it } from "vitest";
import {
  CLIENTE_MAX,
  condicionesBusqueda,
  normalizarRfc,
  validarCapturaClienteDescuento,
} from "./clientes-descuento";

describe("condicionesBusqueda", () => {
  it("sin texto no filtra", () => {
    expect(condicionesBusqueda("")).toEqual({ clausula: "1 = 1", parametros: [] });
    expect(condicionesBusqueda("   ")).toEqual({ clausula: "1 = 1", parametros: [] });
  });

  it("un número (con o sin separadores) busca en celular, otros teléfonos y nombre", () => {
    expect(condicionesBusqueda("8112")).toEqual({
      clausula: "(cliente LIKE ? OR telefono LIKE ? OR telefono2 LIKE ?)",
      parametros: ["%8112%", "%8112%", "%8112%"],
    });
    expect(condicionesBusqueda("+52 81 12-34").parametros[1]).toBe("%52811234%");
  });

  it("un número en formato WhatsApp se normaliza como al guardar", () => {
    expect(condicionesBusqueda("5218112345678").parametros[1]).toBe("%8112345678%");
    expect(condicionesBusqueda("+52 81 1234 5678").parametros[1]).toBe("%8112345678%");
  });

  it("un texto busca por nombre, RFC o email, nunca por teléfono", () => {
    expect(condicionesBusqueda("Taller 3 Hermanos")).toEqual({
      clausula: "(cliente LIKE ? OR rfc LIKE ? OR email LIKE ?)",
      parametros: ["%Taller 3 Hermanos%", "%Taller 3 Hermanos%", "%Taller 3 Hermanos%"],
    });
    expect(condicionesBusqueda("HETJ840501").parametros).toHaveLength(3);
  });

  it("escapa los comodines de LIKE que teclee el usuario", () => {
    expect(condicionesBusqueda("%").parametros[0]).toBe("%\\%%");
    expect(condicionesBusqueda("a_b\\c").parametros[0]).toBe("%a\\_b\\\\c%");
  });
});

describe("normalizarRfc", () => {
  it("mayúsculas y sin separadores", () => {
    expect(normalizarRfc(" hetj 840501-u98 ")).toBe("HETJ840501U98");
    expect(normalizarRfc("")).toBe("");
  });
});

const valido = { telefono: "81 1234 5678", cliente: "  Juan   Pérez ", descuento: 38 };
const datosMinimos = {
  telefono: "8112345678",
  cliente: "Juan Pérez",
  descuento: 38,
  rfc: null,
  telefono2: null,
  email: null,
  idClienteApv: null,
  idClienteBdav: null,
};

describe("validarCapturaClienteDescuento", () => {
  it("normaliza teléfono y nombre de una captura correcta", () => {
    expect(validarCapturaClienteDescuento(valido)).toEqual({ ok: true, datos: datosMinimos });
  });

  it("acepta el teléfono como lo manda WhatsApp y el descuento como texto", () => {
    const r = validarCapturaClienteDescuento({
      telefono: "+5218112345678",
      cliente: "Taller López",
      descuento: "33,5 %",
      idClienteBdav: "5713",
    });
    expect(r).toEqual({
      ok: true,
      datos: { ...datosMinimos, cliente: "Taller López", descuento: 33.5, idClienteBdav: 5713 },
    });
  });

  it("normaliza y guarda los datos de contacto: RFC, otros teléfonos, email, ID APV", () => {
    const r = validarCapturaClienteDescuento({
      ...valido,
      rfc: " hetj840501u98",
      telefono2: "  83630777 -   8118124542 ",
      email: " JCARLOSH84@GMAIL.COM ",
      idClienteApv: "5",
    });
    expect(r).toEqual({
      ok: true,
      datos: {
        ...datosMinimos,
        rfc: "HETJ840501U98",
        telefono2: "83630777 - 8118124542",
        email: "JCARLOSH84@GMAIL.COM",
        idClienteApv: 5,
      },
    });
  });

  it("el celular es opcional: vacío se guarda como null", () => {
    for (const sinCelular of [undefined, "", "   "]) {
      const r = validarCapturaClienteDescuento({ ...valido, telefono: sinCelular });
      expect(r).toEqual({ ok: true, datos: { ...datosMinimos, telefono: null } });
    }
  });

  it("pero si viene, tiene que estar completo", () => {
    expect(validarCapturaClienteDescuento({ ...valido, telefono: "8374 9595" })).toEqual({
      ok: false,
      error: "El celular debe tener 10 dígitos",
    });
  });

  it("rechaza un RFC que no sea de 12 o 13 caracteres", () => {
    expect(validarCapturaClienteDescuento({ ...valido, rfc: "ABC" })).toEqual({
      ok: false,
      error: "El RFC debe tener 12 o 13 caracteres",
    });
    expect(validarCapturaClienteDescuento({ ...valido, rfc: "COM101213PX9" }).ok).toBe(true);
    expect(validarCapturaClienteDescuento({ ...valido, rfc: "ÑAM&850101AB1" }).ok).toBe(true);
  });

  it("acota el largo de otros teléfonos y del email", () => {
    expect(validarCapturaClienteDescuento({ ...valido, telefono2: "1".repeat(61) }).ok).toBe(false);
    expect(validarCapturaClienteDescuento({ ...valido, email: "a".repeat(121) }).ok).toBe(false);
    expect(validarCapturaClienteDescuento({ ...valido, email: "ROSSY_9@LIVE" }).ok).toBe(true);
  });

  it("redondea el descuento a dos decimales", () => {
    const r = validarCapturaClienteDescuento({ ...valido, descuento: 33.3333 });
    expect(r.ok && r.datos.descuento).toBe(33.33);
  });

  it("rechaza cuerpos que no son objetos", () => {
    expect(validarCapturaClienteDescuento(null)).toEqual({ ok: false, error: "Petición inválida" });
    expect(validarCapturaClienteDescuento("x").ok).toBe(false);
    expect(validarCapturaClienteDescuento([]).ok).toBe(false);
  });

  it("exige el nombre del cliente y acota su largo", () => {
    expect(validarCapturaClienteDescuento({ ...valido, cliente: "   " })).toEqual({
      ok: false,
      error: "Captura el nombre del cliente",
    });
    expect(
      validarCapturaClienteDescuento({ ...valido, cliente: "a".repeat(CLIENTE_MAX + 1) }).ok
    ).toBe(false);
    expect(
      validarCapturaClienteDescuento({ ...valido, cliente: "a".repeat(CLIENTE_MAX) }).ok
    ).toBe(true);
  });

  it("rechaza descuentos vacíos, fuera de rango o que no son número", () => {
    const error = "El descuento debe ser un número entre 0 y 100";
    expect(validarCapturaClienteDescuento({ ...valido, descuento: "" })).toEqual({ ok: false, error });
    expect(validarCapturaClienteDescuento({ ...valido, descuento: 101 })).toEqual({ ok: false, error });
    expect(validarCapturaClienteDescuento({ ...valido, descuento: -1 })).toEqual({ ok: false, error });
    expect(validarCapturaClienteDescuento({ ...valido, descuento: "abc" })).toEqual({ ok: false, error });
    expect(validarCapturaClienteDescuento({ ...valido, descuento: null })).toEqual({ ok: false, error });
    expect(validarCapturaClienteDescuento({ ...valido, descuento: Number.NaN })).toEqual({ ok: false, error });
  });

  it("acepta 0% como descuento explícito", () => {
    const r = validarCapturaClienteDescuento({ ...valido, descuento: 0 });
    expect(r.ok && r.datos.descuento).toBe(0);
  });

  it("valida las referencias opcionales (bdav y lista APV)", () => {
    expect(validarCapturaClienteDescuento({ ...valido, idClienteBdav: "" }).ok).toBe(true);
    expect(validarCapturaClienteDescuento({ ...valido, idClienteBdav: 0 })).toEqual({
      ok: false,
      error: "Referencia de cliente inválida",
    });
    expect(validarCapturaClienteDescuento({ ...valido, idClienteBdav: 1.5 }).ok).toBe(false);
    expect(validarCapturaClienteDescuento({ ...valido, idClienteApv: "abc" })).toEqual({
      ok: false,
      error: "ID de cliente APV inválido",
    });
  });

  it("solo acepta referencias enteras seguras escritas en decimal", () => {
    for (const raro of [1e20, "1e20", "0x1F", "0b101", 2 ** 64, "18446744073709551616", -5]) {
      expect(validarCapturaClienteDescuento({ ...valido, idClienteBdav: raro }).ok).toBe(false);
    }
    expect(validarCapturaClienteDescuento({ ...valido, idClienteBdav: " 12 " }).ok).toBe(true);
    expect(validarCapturaClienteDescuento({ ...valido, idClienteBdav: 5713 }).ok).toBe(true);
  });

  it("quita caracteres de control y de formato invisibles del nombre", () => {
    const r = validarCapturaClienteDescuento({
      ...valido,
      cliente: "Juan​​Pérez‮ ⁦García",
    });
    expect(r.ok && r.datos.cliente).toBe("Juan Pérez García");
    expect(validarCapturaClienteDescuento({ ...valido, cliente: "​‍" }).ok).toBe(false);
  });
});
