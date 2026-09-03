import { afterEach, describe, expect, it, vi } from "vitest";
import { fotosDeRespuesta, separarMarcadorFotos, urlFotoWhatsapp } from "./fotos-respuesta";

describe("separarMarcadorFotos", () => {
  it("quita la línea técnica y devuelve los códigos tal como los escribió el agente", () => {
    const respuesta = "Tengo la *Facia Versa* (DDDAI15) en $1,798.00 📦\n[[FOTOS: DDDAI15, gtcae18r ]]";

    expect(separarMarcadorFotos(respuesta)).toEqual({
      texto: "Tengo la *Facia Versa* (DDDAI15) en $1,798.00 📦",
      codigosMarcados: ["DDDAI15", "gtcae18r"],
    });
  });

  it("sin marcador deja el texto igual y ningún código", () => {
    expect(separarMarcadorFotos("¿Para qué año es tu Versa?")).toEqual({
      texto: "¿Para qué año es tu Versa?",
      codigosMarcados: [],
    });
  });

  it("una respuesta que era solo el marcador queda con texto vacío", () => {
    expect(separarMarcadorFotos("[[FOTOS: X1]]").texto).toBe("");
  });
});

describe("urlFotoWhatsapp", () => {
  afterEach(() => vi.restoreAllMocks());

  it("pasa las fotos de Aldo y de la Bodega por el proxy sellado con la marca en la ruta", () => {
    expect(
      urlFotoWhatsapp("https://s3-us-west-2.amazonaws.com/aldoautopartesproductos/DDDAI15.jpg", "https://x.mx", "m1")
    ).toBe("https://x.mx/api/whatsapp/foto/m1/aldo/DDDAI15.jpg");
    expect(
      urlFotoWhatsapp("https://sistema.apvidaurri.com/imagenes_piezas/foto%201.jpg?x=1", "https://x.mx", "m1")
    ).toBe("https://x.mx/api/whatsapp/foto/m1/usadas/foto%201.jpg");
  });

  it("sin base o con origen desconocido devuelve la original y lo deja registrado", () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(urlFotoWhatsapp("https://otro.com/a.jpg", "https://x.mx", "m1")).toBe("https://otro.com/a.jpg");
    expect(
      urlFotoWhatsapp("https://s3-us-west-2.amazonaws.com/aldoautopartesproductos/A.jpg", "", "m1")
    ).toBe("https://s3-us-west-2.amazonaws.com/aldoautopartesproductos/A.jpg");
    expect(aviso).toHaveBeenCalledTimes(2);
  });
});

describe("fotosDeRespuesta", () => {
  it("ignora códigos que ninguna búsqueda devolvió (no consulta nada)", async () => {
    const fotos = await fotosDeRespuesta({
      codigosMarcados: ["INVENTADO1"],
      codigosConsultados: ["DDDAI15"],
      fotosUsadas: new Map(),
      base: "https://x.mx",
    });

    expect(fotos).toEqual([]);
  });

  it("las piezas usadas salen con su foto de la Bodega por el proxy, con el código como lo dio el catálogo", async () => {
    const fotos = await fotosDeRespuesta({
      codigosMarcados: ["us-01"],
      codigosConsultados: ["US-01"],
      fotosUsadas: new Map([["US-01", "https://sistema.apvidaurri.com/imagenes_piezas/p1.jpg"]]),
      base: "https://x.mx",
    });

    expect(fotos).toHaveLength(1);
    expect(fotos[0].codigo).toBe("US-01");
    expect(fotos[0].url).toMatch(/^https:\/\/x\.mx\/api\/whatsapp\/foto\/[a-z0-9]+\/usadas\/p1\.jpg$/);
  });
});
