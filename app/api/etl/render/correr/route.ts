import { after, NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/auth/require-auth";
import { renderConfigurado } from "@/lib/render/db";
import { abrirCorrida, corridaEnCurso, ejecutarCorrida } from "@/lib/render/sync";

export const runtime = "nodejs";
export const maxDuration = 300;

// POST — "Actualizar ahora": arranca la lectura de Render EN EL SERVIDOR y
// responde enseguida. Sigue aunque se cierre la página; la pantalla ve el
// avance en GET /api/etl/render (campo corrida).
export async function POST() {
  const auth = await requireAuthUser();
  if (auth.response) return auth.response;
  if (!renderConfigurado()) return NextResponse.json({ error: "Falta RENDER_DATABASE_URL" }, { status: 400 });
  const id = await abrirCorrida("boton");
  if (id == null) return NextResponse.json({ yaCorriendo: true, corrida: await corridaEnCurso() });
  after(() => ejecutarCorrida(id, auth.user.id));
  return NextResponse.json({ corridaId: id });
}
