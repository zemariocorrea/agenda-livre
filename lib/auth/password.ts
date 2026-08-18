const PASSWORD_SCHEME = "pbkdf2_sha256";
const PBKDF2_ITERATIONS = 600_000;
const SALT_BYTES = 16;
const HASH_BYTES = 32;

export type PasswordValidation = { ok: true } | { ok: false; message: string };

export function validatePassword(password: string): PasswordValidation {
  if (password.length < 12) return { ok: false, message: "A senha deve ter pelo menos 12 caracteres." };
  if (password.length > 128) return { ok: false, message: "A senha deve ter no máximo 128 caracteres." };
  return { ok: true };
}

export async function hashPassword(password: string): Promise<string> {
  const validation = validatePassword(password);
  if (!validation.ok) throw new Error(validation.message);

  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const derived = await derivePassword(password, salt, PBKDF2_ITERATIONS);
  return `${PASSWORD_SCHEME}$${PBKDF2_ITERATIONS}$${toBase64Url(salt)}$${toBase64Url(derived)}`;
}

export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  const parsed = parsePasswordHash(storedHash);
  if (!parsed) return false;

  try {
    const candidate = await derivePassword(password, parsed.salt, parsed.iterations);
    return constantTimeEqual(candidate, parsed.hash);
  } catch {
    return false;
  }
}

export function generateTemporaryPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return toBase64Url(bytes);
}

async function derivePassword(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const passwordKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: new Uint8Array(salt).buffer, iterations },
    passwordKey,
    HASH_BYTES * 8,
  );
  return new Uint8Array(bits);
}

function parsePasswordHash(value: string) {
  const [scheme, iterationsRaw, saltRaw, hashRaw, extra] = value.split("$");
  const iterations = Number(iterationsRaw);
  if (
    scheme !== PASSWORD_SCHEME ||
    extra !== undefined ||
    !Number.isInteger(iterations) ||
    iterations < 100_000 ||
    iterations > 2_000_000
  ) return null;

  try {
    const salt = fromBase64Url(saltRaw);
    const hash = fromBase64Url(hashRaw);
    if (salt.length < 16 || hash.length !== HASH_BYTES) return null;
    return { iterations, salt, hash };
  } catch {
    return null;
  }
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(normalized + padding);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
