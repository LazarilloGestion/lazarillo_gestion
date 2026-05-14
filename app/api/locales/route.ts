import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const locales = await prisma.local.findMany({
    include: { puntosDeVenta: { orderBy: { nombre: "asc" } } },
    orderBy: { nombre: "asc" },
  });
  return NextResponse.json(locales);
}
