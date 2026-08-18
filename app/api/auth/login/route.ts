import { postLoginDestination, safeReturnPath } from "@/lib/auth/access";
import { verifyPassword } from "@/lib/auth/password";
import { rejectCrossSiteMutation, requestTooLarge } from "@/lib/auth/request";
import { createSession } from "@/lib/auth/session";
import { getD1 } from "@/lib/d1";
import { isEmail, normalizeEmail } from "@/lib/http";

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const DUMMY_PASSWORD_HASH = "pbkdf2_sha256$600000$YWdlbmRhLWxpdnJlLWR1bW15$se3m48ZtEW2Aoq9NxurkGwK3OVL5YFi1CHhgyYvrc9w";

export async function POST(request: Request) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;
  if (requestTooLarge(request)) return Response.json({ error: "Requisição inválida." }, { status: 413 });

  let payload: Record<string, unknown>;
  try {
    payload = await request.json() as Record<string, unknown>;
  } catch {
    return invalidCredentials();
  }

  const email = normalizeEmail(payload.email);
  const password = typeof payload.password === "string" ? payload.password : "";
  const returnTo = safeReturnPath(typeof payload.returnTo === "string" ? payload.returnTo : "");
  if (!isEmail(email) || !password || password.length > 256) return invalidCredentials();

  const d1 = await getD1();
  const user = await d1.prepare(`
    SELECT id, email, display_name, password_hash, is_active, must_change_password,
           failed_login_attempts, locked_until
    FROM users
    WHERE email = ?
    LIMIT 1
  `).bind(email).first<{
    id: string;
    email: string;
    display_name: string;
    password_hash: string;
    is_active: number;
    must_change_password: number;
    failed_login_attempts: number;
    locked_until: string | null;
  }>();

  const passwordMatches = await verifyPassword(user?.password_hash ?? DUMMY_PASSWORD_HASH, password);
  if (!user || !user.is_active) return invalidCredentials();

  const isLocked = Boolean(user.locked_until && new Date(user.locked_until).getTime() > Date.now());
  if (!passwordMatches || isLocked) {
    if (!isLocked) await registerFailedLogin(user.id, user.failed_login_attempts);
    return invalidCredentials();
  }

  await d1.batch([
    d1.prepare(`
      UPDATE users
      SET failed_login_attempts = 0, locked_until = NULL, last_login_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(user.id),
    d1.prepare("DELETE FROM auth_sessions WHERE datetime(expires_at) <= CURRENT_TIMESTAMP"),
  ]);

  await createSession(user.id);
  const destination = await postLoginDestination(user.id, returnTo);
  const redirectTo = user.must_change_password
    ? `/alterar-senha?return_to=${encodeURIComponent(destination)}`
    : destination;

  return noStoreJson({ success: true, redirectTo });
}

async function registerFailedLogin(userId: string, previousAttempts: number) {
  const d1 = await getD1();
  const attempts = previousAttempts + 1;
  if (attempts >= MAX_FAILED_ATTEMPTS) {
    const lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString();
    await d1.prepare(`
      UPDATE users
      SET failed_login_attempts = 0, locked_until = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(lockedUntil, userId).run();
    return;
  }
  await d1.prepare("UPDATE users SET failed_login_attempts = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(attempts, userId).run();
}

function invalidCredentials() {
  return noStoreJson({ error: "E-mail ou senha inválidos." }, 401);
}

function noStoreJson(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
