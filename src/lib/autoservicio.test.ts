import { describe, expect, it } from "vitest";
import {
  ERROR_CUPO_ENVIOS_CLIENTE,
  ERROR_SIN_PERMISO_PEDIDO,
  LIMITE_ENVIOS_CLIENTE,
  LIMITE_VICO_CLIENTE,
  MENSAJE_VICO_MAX,
  actorCapturaDe,
  actorVicoDe,
  areaDe,
  canalDe,
  claveConversacionDe,
  claveCupoDe,
  clienteDe,
  datosBorradorDe,
  datosEnvioDe,
  descuentoDe,
  errorCupoEnviosDe,
  errorParaEnviar,
  usuarioDe,
  validarCuerpoVico,
  validarEnvioCliente,
  type Ambito,
} from "./autoservicio";
import type { ClienteDescuento } from "./clientes-descuento";
import { ERROR_CUPO_ENVIOS, LIMITE_ENVIOS_KIOSCO, LIMITE_VICO_KIOSCO } from "./kiosco-api";

// El "ámbito" es lo único que cambia entre las rutas del kiosco (aparato del
// piso) y las del área de clientes (el cliente en su propio dispositivo). Todo
// el trabajo se implementa una vez; de aquí salen las diferencias: la clave
// del borrador, el canal, la sucursal, los precios, quién puede enviar y con
// qué actor habla Vico.

const CLIENTE: ClienteDescuento & { telefono: string } = {
  id: 4,
  telefono: "8112345678",
  telefonos: ["8112345678", "8187654321"],
  cliente: "Taller López",
  descuento: 38,
  rfc: null,
  telefono2: null,
  email: null,
  idClienteApv: null,
  idClienteBdav: null,
  permitirPedido: true,
  creadoPor: null,
  creadoEn: "2026-09-01 10:00:00",
  actualizadoPor: null,
  actualizadoEn: "2026-09-01 10:00:00",
};

const SESION = { kiosco: "piso-1", sucursal: "fierro" as const };
const KIOSCO: Ambito = { tipo: "kiosco", sesion: SESION, cliente: null };
const KIOSCO_CON_CLIENTE: Ambito = { tipo: "kiosco", sesion: SESION, cliente: CLIENTE };
const WEB: Ambito = { tipo: "cliente", cliente: CLIENTE };
const WEB_SIN_PERMISO: Ambito = { tipo: "cliente", cliente: { ...CLIENTE, permitirPedido: false } };

describe("clave del borrador y canal", () => {
  it("el kiosco es del aparato (k:<kiosco>); el cliente es c:<celular>, la misma que WhatsApp", () => {
    expect(actorCapturaDe(KIOSCO)).toEqual({ tipo: "kiosco", kiosco: "piso-1" });
    expect(actorCapturaDe(KIOSCO_CON_CLIENTE)).toEqual({ tipo: "kiosco", kiosco: "piso-1" });
    expect(actorCapturaDe(WEB)).toEqual({ tipo: "cliente", telefono: "8112345678" });
  });

  it("canal kiosco vs web; el usuario de la bitácora y el área del log van con cada uno", () => {
    expect(canalDe(KIOSCO)).toBe("kiosco");
    expect(canalDe(WEB)).toBe("web");
    expect(usuarioDe(KIOSCO)).toBe("kiosco");
    expect(usuarioDe(WEB)).toBe("cliente");
    expect(areaDe(KIOSCO)).toBe("kiosco");
    expect(areaDe(WEB)).toBe("clientes");
  });
});

describe("cliente, precios y borrador", () => {
  it("el cliente del ámbito: null en el kiosco anónimo, el del padrón en los otros dos", () => {
    expect(clienteDe(KIOSCO)).toBeNull();
    expect(clienteDe(KIOSCO_CON_CLIENTE)).toBe(CLIENTE);
    expect(clienteDe(WEB)).toBe(CLIENTE);
  });

  it("precios: mostrador en el kiosco anónimo; SIEMPRE del cliente en el área de clientes", () => {
    expect(descuentoDe(KIOSCO)).toBeNull();
    expect(descuentoDe(KIOSCO_CON_CLIENTE)).toBe(38);
    expect(descuentoDe(WEB)).toBe(38);
    expect(descuentoDe({ tipo: "cliente", cliente: { ...CLIENTE, descuento: 0 } })).toBe(0);
  });

  it("el borrador del cliente nace en canal web, a su nombre, con su celular y su descuento, en Matriz", () => {
    expect(datosBorradorDe(WEB)).toEqual({
      canal: "web",
      idCliente: 4,
      cliente: "Taller López",
      telefono: "8112345678",
      descuentoPct: 38,
      sucursal: "matriz",
    });
  });

  it("el borrador del kiosco sigue igual: sucursal del aparato; público general o el cliente que entró", () => {
    expect(datosBorradorDe(KIOSCO)).toMatchObject({ canal: "kiosco", idCliente: null, cliente: "Público general", sucursal: "fierro" });
    expect(datosBorradorDe(KIOSCO_CON_CLIENTE)).toMatchObject({ canal: "kiosco", idCliente: 4, descuentoPct: 38, sucursal: "fierro" });
  });
});

describe("enviar", () => {
  it("el área de clientes exige permitir_pedido del padrón (403); el kiosco no lo exige", () => {
    expect(errorParaEnviar(WEB)).toBeNull();
    expect(errorParaEnviar(WEB_SIN_PERMISO)).toBe(ERROR_SIN_PERMISO_PEDIDO);
    expect(errorParaEnviar(KIOSCO)).toBeNull();
    expect(errorParaEnviar({ tipo: "kiosco", sesion: SESION, cliente: { ...CLIENTE, permitirPedido: false } })).toBeNull();
  });

  it("los datos del envío: el kiosco anónimo teclea nombre y celular y va a la sucursal del aparato", () => {
    expect(datosEnvioDe(KIOSCO, { nombre: "Ana Ruiz", telefono: "81 8765 4321", sucursal: "matriz" })).toEqual({
      ok: true,
      datos: { cliente: { cliente: "Ana Ruiz", telefono: "8187654321" }, sucursal: "fierro", observaciones: null, domicilio: null },
    });
    expect(datosEnvioDe(KIOSCO, {}).ok).toBe(false);
  });

  it("el kiosco con cliente ignora lo tecleado: nombre y celular del padrón, sucursal del aparato", () => {
    expect(datosEnvioDe(KIOSCO_CON_CLIENTE, { nombre: "Otro", telefono: "8100000000" })).toEqual({
      ok: true,
      datos: { cliente: { cliente: "Taller López", telefono: "8112345678" }, sucursal: "fierro", observaciones: null, domicilio: null },
    });
  });

  it("el área de clientes no vuelve a sellar el cliente (ya nació con él): sucursal y observaciones del cuerpo", () => {
    expect(datosEnvioDe(WEB, { sucursal: "matriz", observaciones: "paso a las 5", nombre: "Otro" })).toEqual({
      ok: true,
      datos: { cliente: null, sucursal: "matriz", observaciones: "paso a las 5", domicilio: null },
    });
    expect(datosEnvioDe(WEB, { nombre: "Ana", telefono: "8187654321" }).ok).toBe(false);
  });

  it("el texto del tope de envíos: al mostrador en el kiosco, a WhatsApp en el área", () => {
    expect(errorCupoEnviosDe(KIOSCO)).toBe(ERROR_CUPO_ENVIOS);
    expect(errorCupoEnviosDe(WEB)).toBe(ERROR_CUPO_ENVIOS_CLIENTE);
  });

  it("el cliente elige la sucursal al enviar (obligatoria, del catálogo) y observaciones opcionales", () => {
    expect(validarEnvioCliente({ sucursal: "fierro" })).toEqual({ ok: true, datos: { sucursal: "fierro", observaciones: null, domicilio: null } });
    expect(validarEnvioCliente({ sucursal: "matriz", observaciones: "  paso a las 5  " })).toEqual({
      ok: true,
      datos: { sucursal: "matriz", observaciones: "paso a las 5", domicilio: null },
    });
    expect(validarEnvioCliente({ sucursal: "bodega" }).ok).toBe(false);
    expect(validarEnvioCliente({}).ok).toBe(false);
    expect(validarEnvioCliente(null).ok).toBe(false);
    expect(validarEnvioCliente({ sucursal: "matriz", observaciones: "x".repeat(501) }).ok).toBe(false);
  });
});

describe("Vico", () => {
  it("en el kiosco habla el actor kiosco (con o sin cliente); en el área, el actor cliente en canal web", () => {
    expect(actorVicoDe(KIOSCO)).toEqual({ tipo: "kiosco", kiosco: "piso-1", sucursal: "fierro", cliente: null });
    expect(actorVicoDe(KIOSCO_CON_CLIENTE)).toMatchObject({ tipo: "kiosco", cliente: { idCliente: 4, descuento: 38 } });
    expect(actorVicoDe(WEB)).toEqual({
      tipo: "cliente",
      idCliente: 4,
      nombre: "Taller López",
      telefono: "8112345678",
      descuento: 38,
      permitirPedido: true,
      canal: "web",
    });
    expect(actorVicoDe(WEB_SIN_PERMISO)).toMatchObject({ tipo: "cliente", permitirPedido: false });
  });

  it("la memoria del chat: por aparato en el kiosco; por cliente (y sesión de la página) en el área, nunca el número de WhatsApp", () => {
    expect(claveConversacionDe(KIOSCO, null)).toBe("k:piso-1");
    expect(claveConversacionDe(KIOSCO, "abc")).toBe("k:piso-1");
    expect(claveConversacionDe(WEB, null)).toBe("w:4");
    expect(claveConversacionDe(WEB, "s1-2")).toBe("w:4:s1-2");
    expect(claveConversacionDe(WEB, "s1-2")).not.toContain("8112345678");
  });

  it("el cuerpo del chat: mensaje obligatorio (recortado), reiniciar opcional, sesión opcional y acotada", () => {
    expect(validarCuerpoVico({ mensaje: "  ¿tienes facia? " })).toEqual({
      ok: true,
      datos: { mensaje: "¿tienes facia?", reiniciar: false, sesion: null },
    });
    expect(validarCuerpoVico({ mensaje: "hola", reiniciar: true, sesion: "abc-123" })).toEqual({
      ok: true,
      datos: { mensaje: "hola", reiniciar: true, sesion: "abc-123" },
    });
    const largo = validarCuerpoVico({ mensaje: "x".repeat(MENSAJE_VICO_MAX + 50) });
    expect(largo.ok && largo.datos.mensaje.length).toBe(MENSAJE_VICO_MAX);
    expect(validarCuerpoVico({ mensaje: "   " }).ok).toBe(false);
    expect(validarCuerpoVico({}).ok).toBe(false);
    expect(validarCuerpoVico(null).ok).toBe(false);
    expect(validarCuerpoVico([]).ok).toBe(false);
    expect(validarCuerpoVico({ mensaje: "hola", sesion: "Con Espacios" }).ok).toBe(false);
    expect(validarCuerpoVico({ mensaje: "hola", sesion: "s".repeat(41) }).ok).toBe(false);
  });
});

describe("topes", () => {
  it("los cupos se cuentan por aparato en el kiosco y por cliente en el área", () => {
    expect(claveCupoDe(KIOSCO)).toBe("k:piso-1");
    expect(claveCupoDe(KIOSCO_CON_CLIENTE)).toBe("k:piso-1");
    expect(claveCupoDe(WEB)).toBe("c:4");
  });

  it("los topes del cliente son los mismos del kiosco: 20 envíos por hora y 20 mensajes por minuto", () => {
    expect(LIMITE_ENVIOS_CLIENTE).toEqual({ maximo: 20, ventanaMs: 60 * 60 * 1000 });
    expect(LIMITE_VICO_CLIENTE).toEqual({ maximo: 20, ventanaMs: 60 * 1000 });
    expect(LIMITE_ENVIOS_CLIENTE).toEqual(LIMITE_ENVIOS_KIOSCO);
    expect(LIMITE_VICO_CLIENTE).toEqual(LIMITE_VICO_KIOSCO);
  });
});
