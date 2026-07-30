import { describe, it, expect, vi } from "vitest";
import { getAuthUser } from "./get-user";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

function mockSupabaseUser(user: { id: string; email: string } | null, error: unknown = null) {
  (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error }) },
  });
}

describe("getAuthUser", () => {
  it("devuelve el usuario cuando la sesión es válida", async () => {
    mockSupabaseUser({ id: "u1", email: "a@b.com" });
    const user = await getAuthUser();
    expect(user?.id).toBe("u1");
  });

  it("devuelve null cuando no hay usuario", async () => {
    mockSupabaseUser(null);
    expect(await getAuthUser()).toBeNull();
  });

  it("devuelve null cuando supabase.auth.getUser() devuelve error", async () => {
    mockSupabaseUser(null, new Error("invalid token"));
    expect(await getAuthUser()).toBeNull();
  });
});
