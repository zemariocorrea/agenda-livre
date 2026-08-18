import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

async function migratedDatabase() {
  const database = new DatabaseSync(":memory:");
  const directory = new URL("../drizzle/", import.meta.url);
  const files = (await readdir(directory)).filter((name) => /^\d+.*\.sql$/.test(name)).sort();
  for (const file of files) {
    database.exec((await readFile(new URL(file, directory), "utf8")).replaceAll("--> statement-breakpoint", ""));
  }
  database.exec("PRAGMA foreign_keys = ON");
  return database;
}

test("internal auth schema persists users, opaque sessions and authorization links", async () => {
  const database = await migratedDatabase();
  database.exec(`
    INSERT INTO users (id, email, display_name, password_hash, must_change_password)
    VALUES ('user_master', 'admin@example.test', 'Admin', 'pbkdf2_sha256$600000$salt$hash', 0);
    UPDATE platform_admins SET user_id = 'user_master' WHERE id = 'platform_admin_seed';
    INSERT INTO auth_sessions (id, user_id, token_hash, expires_at)
    VALUES ('session_1', 'user_master', 'sha256-token-hash', '2099-01-01T00:00:00.000Z');
  `);
  assert.equal(database.prepare("SELECT user_id FROM platform_admins WHERE id = 'platform_admin_seed'").get().user_id, "user_master");
  assert.equal(database.prepare("SELECT token_hash FROM auth_sessions WHERE id = 'session_1'").get().token_hash, "sha256-token-hash");
  assert.throws(() => database.exec("INSERT INTO users (id, email, display_name, password_hash) VALUES ('duplicate', 'admin@example.test', 'X', 'x')"), /UNIQUE/);
  database.close();
});

test("source no longer trusts ChatGPT/OAI identity headers", async () => {
  const roots = [new URL("../app/", import.meta.url), new URL("../lib/", import.meta.url)];
  const forbidden = /oai-authenticated|signin-with-chatgpt|signout-with-chatgpt|requireChatGPTUser|getChatGPTUser/i;
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const url = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
      if (entry.isDirectory()) await visit(url);
      else if (/\.(ts|tsx|js|mjs)$/.test(entry.name)) assert.doesNotMatch(await readFile(url, "utf8"), forbidden, url.pathname);
    }
  }
  for (const root of roots) await visit(root);
});

test("password and session policies use the internal security primitives", async () => {
  const password = await readFile(new URL("../lib/auth/password.ts", import.meta.url), "utf8");
  const session = await readFile(new URL("../lib/auth/session.ts", import.meta.url), "utf8");
  assert.match(password, /PBKDF2_ITERATIONS\s*=\s*600_000/);
  assert.match(password, /name:\s*"PBKDF2"/);
  assert.match(session, /randomToken\(32\)/);
  assert.match(session, /crypto\.getRandomValues/);
  assert.match(session, /httpOnly:\s*true/);
  assert.match(session, /sameSite:\s*"lax"/);
  assert.match(session, /token_hash/);
  assert.match(session, /datetime\(auth_sessions\.expires_at\)/);
  assert.match(session, /expires:\s*new Date\(0\)/);
});
