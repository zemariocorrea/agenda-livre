import { cookies } from "next/headers";
import { getD1 } from "../d1";

const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;
const PRODUCTION_COOKIE = "__Host-agenda_session";
const DEVELOPMENT_COOKIE = "agenda_session";

export type AuthenticatedUser = {
  id: string;
  email: string;
  displayName: string;
  mustChangePassword: boolean;
};

export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(sessionCookieName())?.value;
  if (!token) return null;

  const tokenHash = await sha256(token);
  const d1 = await getD1();
  const row = await d1.prepare(`
    SELECT users.id, users.email, users.display_name, users.must_change_password
    FROM auth_sessions
    INNER JOIN users ON users.id = auth_sessions.user_id
    WHERE auth_sessions.token_hash = ?
      AND datetime(auth_sessions.expires_at) > CURRENT_TIMESTAMP
      AND users.is_active = 1
    LIMIT 1
  `).bind(tokenHash).first<{
    id: string;
    email: string;
    display_name: string;
    must_change_password: number;
  }>();

  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    mustChangePassword: Boolean(row.must_change_password),
  };
}

export async function createSession(userId: string): Promise<void> {
  const token = randomToken(32);
  const tokenHash = await sha256(token);
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();
  const d1 = await getD1();

  await d1.prepare(`
    INSERT INTO auth_sessions (id, user_id, token_hash, expires_at)
    VALUES (?, ?, ?, ?)
  `).bind(crypto.randomUUID(), userId, tokenHash, expiresAt).run();

  const cookieStore = await cookies();
  cookieStore.set(sessionCookieName(), token, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax",
    path: "/",
    expires: new Date(expiresAt),
  });
}

export async function destroyCurrentSession(): Promise<void> {
  const cookieStore = await cookies();
  const cookieName = sessionCookieName();
  const token = cookieStore.get(cookieName)?.value;
  if (token) {
    const d1 = await getD1();
    await d1.prepare("DELETE FROM auth_sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  }
  clearSessionCookie(cookieStore);
}

export async function rotateAllSessions(userId: string): Promise<void> {
  const d1 = await getD1();
  await d1.prepare("DELETE FROM auth_sessions WHERE user_id = ?").bind(userId).run();
  const cookieStore = await cookies();
  clearSessionCookie(cookieStore);
  await createSession(userId);
}

export async function revokeAllSessions(userId: string): Promise<void> {
  const d1 = await getD1();
  await d1.prepare("DELETE FROM auth_sessions WHERE user_id = ?").bind(userId).run();
}

export function sessionCookieName(): string {
  return isProduction() ? PRODUCTION_COOKIE : DEVELOPMENT_COOKIE;
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function clearSessionCookie(cookieStore: Awaited<ReturnType<typeof cookies>>): void {
  cookieStore.set(sessionCookieName(), "", {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax",
    path: "/",
    expires: new Date(0),
  });
}

function randomToken(byteLength: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}
