function encryptionKey() {
  const encoded = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!encoded) throw new Error("INTEGRATION_ENCRYPTION_KEY_NOT_CONFIGURED");
  const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  if (bytes.byteLength !== 32) throw new Error("INTEGRATION_ENCRYPTION_KEY_MUST_BE_32_BYTES");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function base64(bytes: Uint8Array) {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
}

function fromBase64(value: string) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

export async function encryptSecret(value: unknown) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(), plaintext);
  return `v1.${base64(iv)}.${base64(new Uint8Array(encrypted))}`;
}

export async function decryptSecret<T>(value: string): Promise<T> {
  const [version, ivEncoded, contentEncoded] = value.split(".");
  if (version !== "v1" || !ivEncoded || !contentEncoded) throw new Error("INVALID_ENCRYPTED_SECRET");
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(ivEncoded) }, await encryptionKey(), fromBase64(contentEncoded));
  return JSON.parse(new TextDecoder().decode(decrypted)) as T;
}

export async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
