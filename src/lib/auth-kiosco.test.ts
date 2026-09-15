import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { exigirKiosco, leerCabeceraKiosco, CABECERA_KIOSCO } from "./auth-kiosco";
import { firmarSesionMostrador } from "./auth-mostrador";

// El kiosco NO tiene sesión de persona: la credencial es del aparato. Estas
// pruebas cuidan las dos cosas que no pueden fallar nunca: que sin la API key
// de servidor a servidor no entre nadie, y que el JWT del mostrador no sirva
// aquí (si sirviera, cualquier vendedor con su token podría hablarle a las
// rutas del kiosco, y al revés la cookie del piso abriría el mostrador).

const API_KEY = "key-de-pruebas";

function peticion(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/kiosco/borrador", { headers });
}

const CABECERAS_OK = { "x-api-key": API_KEY, [CABECERA_KIOSCO]: "piso-1|matriz" };

describe("leerCabeceraKiosco", () => {
  it("parte '<kiosco>|<sucursal>' y valida los dos lados", () => {
    expect(leerCabeceraKiosco("piso-1|matriz")).toEqual({ kiosco: "piso-1", sucursal: "matriz" });
    expect(leerCabeceraKiosco(" mostrador-2 | fierro ")).toEqual({ kiosco: "mostrador-2", sucursal: "fierro" });
  });

  it("rechaza sucursales que no son del catálogo", () => {
    expect(leerCabeceraKiosco("piso-1|bodega")).toBeNull();
    expect(leerCabeceraKiosco("piso-1|")).toBeNull();
    expect(leerCabeceraKiosco("piso-1|MATRIZ")).toBeNull();
  });

  it("rechaza identificadores fuera de [a-z0-9-]{1,30}", () => {
    for (const malo of ["", "Piso-1", "piso 1", "piso_1", "piso/../otro", "k".repeat(31), "piso;drop"]) {
      expect(leerCabeceraKiosco(`${malo}|matriz`)).toBeNull();
    }
    expect(leerCabeceraKiosco("k".repeat(30) + "|matriz")).not.toBeNull();
  });

  it("rechaza lo que no trae exactamente dos partes", () => {
    expect(leerCabeceraKiosco("piso-1")).toBeNull();
    expect(leerCabeceraKiosco("piso-1|matriz|extra")).toBeNull();
    expect(leerCabeceraKiosco("")).toBeNull();
    expect(leerCabeceraKiosco(null)).toBeNull();
  });
});

describe("exigirKiosco", () => {
  const original = { ...process.env };

  beforeEach(() => {
    process.env.MOSTRADOR_API_KEY = API_KEY;
    process.env.MOSTRADOR_JWT_SECRET = "secreto-de-pruebas-del-mostrador";
  });

  afterEach(() => {
    process.env = { ...original };
  });

  it("deja pasar con API key y cabecera del aparato", async () => {
    const guardia = await exigirKiosco(peticion(CABECERAS_OK));

    expect(guardia.ok).toBe(true);
    if (guardia.ok) expect(guardia.kiosco).toEqual({ kiosco: "piso-1", sucursal: "matriz" });
  });

  it("sin API key no entra (401 con código api_key)", async () => {
    const guardia = await exigirKiosco(peticion({ [CABECERA_KIOSCO]: "piso-1|matriz" }));

    expect(guardia.ok).toBe(false);
    if (!guardia.ok) {
      expect(guardia.respuesta.status).toBe(401);
      await expect(guardia.respuesta.json()).resolves.toMatchObject({ ok: false, codigo: "api_key" });
    }
  });

  it("con API key equivocada tampoco", async () => {
    const guardia = await exigirKiosco(peticion({ ...CABECERAS_OK, "x-api-key": "otra" }));
    expect(guardia.ok).toBe(false);
  });

  it("sin la variable configurada la puerta queda cerrada", async () => {
    delete process.env.MOSTRADOR_API_KEY;
    const guardia = await exigirKiosco(peticion(CABECERAS_OK));
    expect(guardia.ok).toBe(false);
  });

  it("con API key pero sin cabecera del aparato: 401 de kiosco, no de sesión de vendedor", async () => {
    const guardia = await exigirKiosco(peticion({ "x-api-key": API_KEY }));

    expect(guardia.ok).toBe(false);
    if (!guardia.ok) {
      expect(guardia.respuesta.status).toBe(401);
      await expect(guardia.respuesta.json()).resolves.toMatchObject({ codigo: "kiosco" });
    }
  });

  it("NUNCA acepta el JWT del mostrador en lugar de la cabecera del aparato", async () => {
    const token = await firmarSesionMostrador({
      id: 7,
      usuario: "jperez",
      nombre: "Juan Pérez",
      perfil: "Administrador",
      nivel: 1,
      serie: null,
    });

    const guardia = await exigirKiosco(
      peticion({ "x-api-key": API_KEY, authorization: `Bearer ${token}` })
    );

    expect(guardia.ok).toBe(false);
  });

  it("un kiosco no puede decir que es de otra sucursal metiendo basura en la cabecera", async () => {
    const guardia = await exigirKiosco(peticion({ ...CABECERAS_OK, [CABECERA_KIOSCO]: "piso-1|matriz'--" }));
    expect(guardia.ok).toBe(false);
  });
});
