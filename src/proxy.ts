// Next 16 renomeou "middleware" para "proxy" (o DESIGN previa src/middleware.ts).
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Exige sessão em tudo, menos login e rotas dos workers (que conferem o segredo). */
export async function proxy(req: NextRequest) {
  let res = NextResponse.next({ request: req });
  const db = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "", {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (lista) => {
        for (const c of lista) req.cookies.set(c.name, c.value);
        res = NextResponse.next({ request: req });
        for (const c of lista) res.cookies.set(c.name, c.value, c.options);
      },
    },
  });
  const { data } = await db.auth.getUser();
  if (!data.user) {
    if (req.nextUrl.pathname.startsWith("/api/")) return NextResponse.json({ erro: "faça login" }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  return res;
}

export const config = {
  matcher: ["/((?!login|api/auth/login|api/worker/|_next/static|_next/image|favicon.ico).*)"],
};
