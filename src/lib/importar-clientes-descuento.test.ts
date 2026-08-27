import { describe, expect, it } from "vitest";
import { decodificarCsv, leerListaApv, parsearCsv } from "./importar-clientes-descuento";

const ENCABEZADO = "ID CLIENTE ,RFC,Nombre,Teléfono 1,telefono2,Email ,DESCUENTO";

describe("parsearCsv", () => {
  it("separa campos, respeta comillas y comillas escapadas, y acepta CRLF", () => {
    const filas = parsearCsv('a,b\r\n1,"x, y"\r\n2,"""Entre comillas"""\n');
    expect(filas).toEqual([
      ["a", "b"],
      ["1", "x, y"],
      ["2", '"Entre comillas"'],
    ]);
  });
});

describe("decodificarCsv", () => {
  it("lee UTF-8 y, si el archivo viene de Excel en Windows-1252, también", () => {
    expect(decodificarCsv(new TextEncoder().encode("Teléfono"))).toBe("Teléfono");
    // "Tel" + 0xE9 ("é" en Windows-1252, inválido como UTF-8) + "fono"
    const excel = new Uint8Array([0x54, 0x65, 0x6c, 0xe9, 0x66, 0x6f, 0x6e, 0x6f]);
    expect(decodificarCsv(excel)).toBe("Teléfono");
  });
});

describe("leerListaApv", () => {
  it("interpreta una fila normal de la lista", () => {
    const { filas, omitidas, advertencias } = leerListaApv(
      `${ENCABEZADO}\r\n5,hetj840501u98,HERNANDEZ TORRES JUAN CARLOS,8118124542,83630777 - 8118124542,JCARLOSH84@GMAIL.COM,33\r\n`
    );
    expect(omitidas).toEqual([]);
    expect(advertencias).toEqual([]);
    expect(filas).toEqual([
      {
        linea: 2,
        idClienteApv: 5,
        telefono: "8118124542",
        cliente: "HERNANDEZ TORRES JUAN CARLOS",
        descuento: 33,
        rfc: "HETJ840501U98",
        telefono2: "83630777 - 8118124542",
        email: "JCARLOSH84@GMAIL.COM",
        idClienteBdav: null,
      },
    ]);
  });

  it("un cliente sin celular entra igual, con el celular en null", () => {
    const { filas } = leerListaApv(
      `${ENCABEZADO}\n4,COM101213PX9,LA CORNETA DE ORO MG,,83537476 - 83549915,CORNETA@PRODIGY.NET.MX,33`
    );
    expect(filas[0].telefono).toBeNull();
    expect(filas[0].telefono2).toBe("83537476 - 83549915");
  });

  it("un fijo de 8 dígitos en la columna del celular pasa a otros teléfonos y se avisa", () => {
    const { filas, advertencias } = leerListaApv(
      `${ENCABEZADO}\n9,GAP930520IZ6,GARZ AUTO PARTES,83553600,24620233,g@x.com,33`
    );
    expect(filas[0].telefono).toBeNull();
    expect(filas[0].telefono2).toBe("83553600 / 24620233");
    expect(advertencias).toEqual([
      { linea: 2, motivo: '"83553600" no es un celular de 10 dígitos: se guardó en otros teléfonos' },
    ]);
  });

  it("acepta el celular con lada de país y con separadores", () => {
    const { filas } = leerListaApv(`${ENCABEZADO}\n1,X,Uno,+52 81 1234 5678,,,33\n2,X,Dos,5218112345679,,,33`);
    expect(filas.map((f) => f.telefono)).toEqual(["8112345678", "8112345679"]);
  });

  it("omite filas sin ID válido, sin nombre o con ID repetido, diciendo por qué", () => {
    const { filas, omitidas } = leerListaApv(
      [
        ENCABEZADO,
        "x,RFC1,Sin id,,,,33",
        "5679,MEPJ000831MP7,,,,,33",
        "7,RFC7,Primero,,,,33",
        "7,RFC7,Repetido,,,,38",
      ].join("\n")
    );
    expect(filas.map((f) => f.cliente)).toEqual(["Primero"]);
    expect(omitidas).toEqual([
      { linea: 2, motivo: 'ID CLIENTE inválido ("x")' },
      { linea: 3, motivo: "Captura el nombre del cliente" },
      { linea: 5, motivo: "ID CLIENTE 7 repetido: ya venía en la línea 4" },
    ]);
  });

  it("el nombre entre comillas y el RFC en minúsculas se normalizan", () => {
    const { filas } = leerListaApv(
      `${ENCABEZADO}\n7,raf1102256l3,"""REFACCIONES AUTOMOTRICES FERNANDEZ""",,,,33`
    );
    expect(filas[0].cliente).toBe('"REFACCIONES AUTOMOTRICES FERNANDEZ"');
    expect(filas[0].rfc).toBe("RAF1102256L3");
  });

  it("un email con formato raro se conserva tal cual: es el que el negocio tiene", () => {
    const { filas } = leerListaApv(`${ENCABEZADO}\n8,X,Ocho,,,"PEPE.HDZ1973@GMAIL,COM",33`);
    expect(filas[0].email).toBe("PEPE.HDZ1973@GMAIL,COM");
  });

  it("exige las columnas obligatorias y rechaza un archivo vacío", () => {
    expect(() => leerListaApv("RFC,Nombre\nX,Y")).toThrow('El archivo no trae la columna "ID CLIENTE"');
    expect(() => leerListaApv("\n\n")).toThrow("El archivo está vacío");
  });
});
