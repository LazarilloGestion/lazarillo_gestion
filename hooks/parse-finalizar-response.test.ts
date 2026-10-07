import { describe, it, expect } from "vitest";
import { parseFinalizarResponse } from "./parse-finalizar-response";

describe("parseFinalizarResponse", () => {
  it("200 con apertura -> ok y devuelve errores/omitidas tal cual", () => {
    const apertura = { errores: ["x"], omitidas: ["y"] };
    expect(parseFinalizarResponse(true, 200, { apertura })).toEqual({ tipo: "ok", apertura });
  });

  it("200 sin campo apertura -> ok con apertura null", () => {
    expect(parseFinalizarResponse(true, 200, {})).toEqual({ tipo: "ok", apertura: null });
  });

  it("504 del timeout de Vercel (cuerpo no JSON) -> fallo con el status", () => {
    // Pasó el 3-oct-2026: el barrido se cortó a los 60 s y la UI no avisó nada.
    const r = parseFinalizarResponse(false, 504, null);
    expect(r.tipo).toBe("fallo");
    if (r.tipo === "fallo") expect(r.motivo).toContain("504");
  });

  it("500 con { error } -> fallo con el mensaje del servidor", () => {
    expect(parseFinalizarResponse(false, 500, { error: "boom" })).toEqual({ tipo: "fallo", motivo: "boom" });
  });

  it("200 con cuerpo que no es JSON -> fallo (no se puede saber si aplicó)", () => {
    const r = parseFinalizarResponse(true, 200, null);
    expect(r.tipo).toBe("fallo");
  });
});
