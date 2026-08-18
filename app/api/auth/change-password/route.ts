import { postLoginDestination } from "@/lib/auth/access";
import { hashPassword, validatePassword, verifyPassword } from "@/lib/auth/password";
import { rejectCrossSiteMutation, requestTooLarge } from "@/lib/auth/request";
import { getCurrentUser, rotateAllSessions } from "@/lib/auth/session";
import { getD1 } from "@/lib/d1";
import { jsonError } from "@/lib/http";

export async function POST(request: Request) {
  const crossSite = rejectCrossSiteMutation(request);
  if (crossSite) return crossSite;
  if (requestTooLarge(request)) return jsonError("Requisição inválida.", 413, "PAYLOAD_TOO_LARGE");

  const user = await getCurrentUser();
  if (!user) return jsonError("Sua sessão expirou. Entre novamente.", 401, "UNAUTHENTICATED");

  let payload: Record<string, unknown>;
  try {
    payload = await request.json() as Record<string, unknown>;
  } catch {
    return jsonError("Dados inválidos.");
  }

  const currentPassword = typeof payload.currentPassword === "string" ? payload.currentPassword : "";
  const newPassword = typeof payload.newPassword === "string" ? payload.newPassword : "";
  const confirmation = typeof payload.confirmPassword === "string" ? payload.confirmPassword : "";
  const validation = validatePassword(newPassword);
  if (!validation.ok) return jsonError(validation.message);
  if (newPassword !== confirmation) return jsonError("A confirmação da nova senha não confere.");
  if (currentPassword === newPassword) return jsonError("Escolha uma senha diferente da atual.");

  const d1 = await getD1();
  const stored = await d1.prepare("SELECT password_hash FROM users WHERE id = ? AND is_active = 1 LIMIT 1")
    .bind(user.id).first<{ password_hash: string }>();
  if (!stored || !await verifyPassword(stored.password_hash, currentPassword)) {
    return jsonError("Senha atual inválida.", 401, "INVALID_CURRENT_PASSWORD");
  }

  const passwordHash = await hashPassword(newPassword);
  await d1.prepare(`
    UPDATE users
    SET password_hash = ?, must_change_password = 0, failed_login_attempts = 0,
        locked_until = NULL, password_changed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(passwordHash, user.id).run();
  await rotateAllSessions(user.id);

  const returnTo = typeof payload.returnTo === "string" ? payload.returnTo : null;
  return Response.json({ success: true, redirectTo: await postLoginDestination(user.id, returnTo) }, {
    headers: { "Cache-Control": "no-store" },
  });
}
