import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_SESION } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST() {
  const jar = await cookies();
  jar.delete(COOKIE_SESION);
  return NextResponse.json({ ok: true });
}
