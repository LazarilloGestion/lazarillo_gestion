import { NextRequest, NextResponse } from "next/server";
import { createMiddlewareClient } from "@/lib/supabase/middleware";

const PUBLIC_PATHS = ["/login", "/auth/callback"];

export async function middleware(request: NextRequest) {
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

  // Autenticado + intenta /login → redirigir al dashboard
  if (user && pathname === "/login") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  // No autenticado + ruta protegida → login preservando destino
  if (!user && !isPublic) {
    const loginUrl = new URL("/login", request.url);
    // Solo pasar pathname + search para prevenir open redirect
    const next = pathname + (searchParams.toString() ? `?${searchParams}` : "");
    loginUrl.searchParams.set("next", next);
    return NextResponse.redirect(loginUrl);
  }

  // Retornar response con cookies actualizadas (refresh token automático)
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
