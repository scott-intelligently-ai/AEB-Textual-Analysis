import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isAllowed } from "@/lib/auth/allowlist";

function safeNext(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/login")) {
    return "/";
  }
  return value;
}

export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return NextResponse.next();

  let supabaseResponse = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        supabaseResponse = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          supabaseResponse.cookies.set(name, value, options);
        }
      },
    },
  });

  const { data } = await supabase.auth.getUser();
  const user = data.user;
  const path = request.nextUrl.pathname;
  const isPublic = path === "/login" || path.startsWith("/auth/");

  const carry = (response: NextResponse) => {
    for (const cookie of supabaseResponse.cookies.getAll()) response.cookies.set(cookie);
    return response;
  };
  const redirect = (pathname: string, search = "") => {
    const destination = request.nextUrl.clone();
    destination.pathname = pathname;
    destination.search = search;
    return carry(NextResponse.redirect(destination));
  };

  if (user && !isAllowed(user.email)) {
    await supabase.auth.signOut();
    if (path.startsWith("/api")) {
      return carry(
        NextResponse.json(
          { error: "This account is not allowed to use this application." },
          { status: 403 },
        ),
      );
    }
    if (path !== "/login") return redirect("/login", "?error=not-allowed");
    return supabaseResponse;
  }

  if (!user && !isPublic) {
    if (path.startsWith("/api")) {
      return NextResponse.json({ error: "Sign in required." }, { status: 401 });
    }
    const next = `${path}${request.nextUrl.search}`;
    return redirect("/login", `?next=${encodeURIComponent(next)}`);
  }

  if (user && path === "/login") return redirect(safeNext(request.nextUrl.searchParams.get("next")));
  return supabaseResponse;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
