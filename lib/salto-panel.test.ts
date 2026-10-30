import { describe, expect, it } from "vitest";
import { saltoPanel } from "./salto-panel";

describe("salto entre paneles", () => {
  it("solo la cuenta de Lazarillo, y va al otro panel", () => {
    expect(saltoPanel("lazarillogestion@gmail.com", "https://agykidgtdmkoplimjqrp.supabase.co")?.label).toBe("Ir a Comercio");
    expect(saltoPanel("LazarilloGestion@gmail.com ", "https://xvdzyqyylmsglpxycezk.supabase.co")?.label).toBe("Ir a Container");
    expect(saltoPanel("infobuffetcomercio@gmail.com", "https://xvdzyqyylmsglpxycezk.supabase.co")).toBeNull();
    expect(saltoPanel(null)).toBeNull();
  });
});
