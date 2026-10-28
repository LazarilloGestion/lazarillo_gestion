import { NextRequest, NextResponse } from "next/server";
import { createMiddlewareClient } from "@/lib/supabase/middleware";
import { isAllowedEmail } from "@/lib/auth/allowed-emails";

// /api/cron: lo llama el cron de Vercel sin sesión; la ruta valida su propio secreto.
const PUBLIC_PATHS = ["/login", "/auth/callback", "/api/cron"];

export async function proxy(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;

  const response = NextResponse.next({
    request: { headers: request.headers },
  });

  const supabase = createMiddlewareClient(request, response);

  // getUser() valida JWT contra Supabase Auth server — detecta tokens revocados
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );

  // Cualquier NextResponse que no sea `response` pierde las cookies que
  // createMiddlewareClient/signOut ya escribieron ahí (refresh de sesión,
  // borrado de sesión rechazada) — copiarlas explícitamente antes de devolver.
  const withUpdatedCookies = (res: NextResponse): NextResponse => {
    for (const cookie of response.cookies.getAll()) {
      res.cookies.set(cookie);
    }
    return res;
  };

  // Email no autorizado → cerrar sesión y redirigir
  if (user && !isAllowedEmail(user.email)) {
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) {
      console.error("[proxy] Error al cerrar sesión de cuenta no autorizada:", signOutError);
    }
    return withUpdatedCookies(
      NextResponse.redirect(new URL("/login?error=unauthorized", request.url))
    );
  }

  // Autenticado + intenta /login → redirigir al dashboard
  if (user && pathname === "/login") {
    return withUpdatedCookies(NextResponse.redirect(new URL("/dashboard", request.url)));
  }

  // No autenticado + ruta protegida:
  // - /api/*: 401 JSON — el cliente (fetch) espera JSON, no un redirect que
  //   termina devolviendo el HTML de /login con status 200.
  // - páginas: redirect a /login preservando destino.
  if (!user && !isPublic) {
    if (pathname.startsWith("/api/")) {
      return withUpdatedCookies(NextResponse.json({ error: "No autorizado" }, { status: 401 }));
    }
    const loginUrl = new URL("/login", request.url);
    // Solo pasar pathname + search para prevenir open redirect
    const next = pathname + (searchParams.toString() ? `?${searchParams}` : "");
    loginUrl.searchParams.set("next", next);
    return withUpdatedCookies(NextResponse.redirect(loginUrl));
  }

  // Retornar response con cookies actualizadas (refresh token automático)
  return response;
}

export const config = {
  matcher: [
    // La exclusión por extensión de archivo NO aplica bajo /api/ — una ruta
    // dinámica como /api/dashboard/compras/[rowId] puede coincidir por
    // casualidad (ej. un rowId que termine en ".png") y saltear el
    // middleware por completo si no se excluye explícitamente ese prefijo.
    // manifest-m: el de la versión celular (/m), para "Agregar a inicio" desde /m.
    // sw.js: el service worker "de baja" tiene que llegar aunque no haya sesión.
    "/((?!_next/static|_next/image|favicon.ico|manifest\\\\.webmanifest|manifest-m\\\\.webmanifest|sw\\\\.js|(?!api/).*\\\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
