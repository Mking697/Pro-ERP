import { NextResponse } from "next/server";
import { z } from "zod";
import { findUserByEmail, verifyPassword } from "@/lib/auth/users";
import { signSession, SESSION_COOKIE } from "@/lib/auth/session";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Please enter a valid email and password." },
      { status: 400 }
    );
  }

  const { email, password } = parsed.data;

  const user = await findUserByEmail(email);
  if (!user || user.Status !== "Active") {
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }

  const passwordOk = await verifyPassword(password, user.Password_Hash);
  if (!passwordOk) {
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }

  const token = await signSession({
    userId: user.User_ID,
    email: user.Email,
    fullName: user.Full_Name,
    role: user.Role,
  });

  const response = NextResponse.json({
    user: {
      userId: user.User_ID,
      fullName: user.Full_Name,
      email: user.Email,
      role: user.Role,
    },
  });

  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 8,
  });

  return response;
}
