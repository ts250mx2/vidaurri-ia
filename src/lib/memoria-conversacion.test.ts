import { describe, expect, it } from "vitest";
import { crearMemoriaConversacion } from "./memoria-conversacion";

describe("crearMemoriaConversacion", () => {
  it("recuerda los turnos en orden y por clave", () => {
    const memoria = crearMemoriaConversacion();

    memoria.guardarTurno("m:jperez", "hola", "¿qué pieza buscas?");
    memoria.guardarTurno("m:jperez", "facia versa", "tengo la DDDAI15");

    expect(memoria.historialDe("m:jperez")).toEqual([
      { rol: "usuario", texto: "hola" },
      { rol: "agente", texto: "¿qué pieza buscas?" },
      { rol: "usuario", texto: "facia versa" },
      { rol: "agente", texto: "tengo la DDDAI15" },
    ]);
    expect(memoria.historialDe("8112345678")).toEqual([]);
  });

  it("recorta al tope de mensajes conservando los más recientes", () => {
    const memoria = crearMemoriaConversacion({ maxHistorial: 4 });

    memoria.guardarTurno("k", "p1", "r1");
    memoria.guardarTurno("k", "p2", "r2");
    memoria.guardarTurno("k", "p3", "r3");

    expect(memoria.historialDe("k").map((m) => m.texto)).toEqual(["p2", "r2", "p3", "r3"]);
  });

  it("olvida la conversación tras el TTL de inactividad", () => {
    let reloj = 1_000;
    const memoria = crearMemoriaConversacion({ ttlMs: 100, ahora: () => reloj });

    memoria.guardarTurno("k", "p", "r");
    reloj = 1_099;
    expect(memoria.historialDe("k")).toHaveLength(2);

    reloj = 1_101;
    expect(memoria.historialDe("k")).toEqual([]);
  });

  it("un turno nuevo renueva la expiración", () => {
    let reloj = 0;
    const memoria = crearMemoriaConversacion({ ttlMs: 100, ahora: () => reloj });

    memoria.guardarTurno("k", "p1", "r1");
    reloj = 80;
    memoria.guardarTurno("k", "p2", "r2");
    reloj = 170;

    expect(memoria.historialDe("k")).toHaveLength(4);
  });

  it("olvidar empieza de cero", () => {
    const memoria = crearMemoriaConversacion();
    memoria.guardarTurno("k", "p", "r");

    memoria.olvidar("k");

    expect(memoria.historialDe("k")).toEqual([]);
  });
});
