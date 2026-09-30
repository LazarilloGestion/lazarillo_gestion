import { describe, it, expect, vi } from "vitest";
import { requireAuth, requireAuthUser } from "./require-auth";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

function mockSupabaseUser(user: { id: string; email: string } | null, error: unknown = null) {
  (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error }) },
  });
}

describe("requireAuth", () => {
  it("devuelve null cuando hay usuario válido con email permitido", async () => {
    mockSupabaseUser({ id: "u1", email: "lazarillogestion@gmail.com" });
    expect(await requireAuth()).toBeNull();
  });

  it("devuelve 401 cuando no hay usuario", async () => {
    mockSupabaseUser(null);
    const res = await requireAuth();
    expect(res?.status).toBe(401);
  });

  it("devuelve 401 cuando supabase.auth.getUser() devuelve error (token revocado)", async () => {
    mockSupabaseUser(null, new Error("invalid token"));
    const res = await requireAuth();
    expect(res?.status).toBe(401);
  });

  it("devuelve 401 cuando hay sesión válida pero el email no está en la allowlist", async () => {
    mockSupabaseUser({ id: "u2", email: "otro@gmail.com" });
    const res = await requireAuth();
    expect(res?.status).toBe(401);
  });
});

describe("requireAuthUser", () => {
  it("devuelve { user, response: null } cuando está autenticado con email permitido", async () => {
    mockSupabaseUser({ id: "u1", email: "lazarillogestion@gmail.com" });
    const result = await requireAuthUser();
    expect(result.response).toBeNull();
    expect(result.user?.id).toBe("u1");
  });

  it("devuelve { user: null, response: 401 } cuando no está autenticado", async () => {
    mockSupabaseUser(null);
    const result = await requireAuthUser();
    expect(result.user).toBeNull();
    expect(result.response?.status).toBe(401);
  });

  it("devuelve { user: null, response: 401 } cuando el email no está en la allowlist", async () => {
    mockSupabaseUser({ id: "u2", email: "otro@gmail.com" });
    const result = await requireAuthUser();
    expect(result.user).toBeNull();
    expect(result.response?.status).toBe(401);
  });
});
