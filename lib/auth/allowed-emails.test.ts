import { describe, it, expect } from "vitest";
import { parseAllowedEmails } from "./allowed-emails";

describe("parseAllowedEmails", () => {
  it("sin variable queda la cuenta original", () => {
    expect(parseAllowedEmails(undefined)).toEqual(["lazarillogestion@gmail.com"]);
    expect(parseAllowedEmails("")).toEqual(["lazarillogestion@gmail.com"]);
    expect(parseAllowedEmails(" , ")).toEqual(["lazarillogestion@gmail.com"]);
  });

  it("separa por coma, recorta espacios y pasa a minúsculas", () => {
    expect(parseAllowedEmails(" InfoBuffetComercio@gmail.com , otra@dominio.com ")).toEqual([
      "infobuffetcomercio@gmail.com",
      "otra@dominio.com",
    ]);
  });
});
