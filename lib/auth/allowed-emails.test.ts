import { describe, it, expect } from "vitest";
import { isAllowedEmail } from "./allowed-emails";

describe("isAllowedEmail", () => {
  it("acepta el único email permitido", () => {
    expect(isAllowedEmail("lazarillogestion@gmail.com")).toBe(true);
  });

  it("rechaza cualquier otro email", () => {
    expect(isAllowedEmail("otro@gmail.com")).toBe(false);
  });

  it("rechaza null", () => {
    expect(isAllowedEmail(null)).toBe(false);
  });

  it("rechaza undefined", () => {
    expect(isAllowedEmail(undefined)).toBe(false);
  });

  it("rechaza string vacío", () => {
    expect(isAllowedEmail("")).toBe(false);
  });
});
