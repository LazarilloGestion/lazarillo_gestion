import type { User } from "@supabase/supabase-js";
import { requireAuthUser } from "./require-auth";

export async function getAuthUser(): Promise<User | null> {
  const { user } = await requireAuthUser();
  return user;
}
