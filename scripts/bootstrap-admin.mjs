import { pbkdf2Sync, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const args = parseArgs(process.argv.slice(2));
const email = String(args.email ?? process.env.AGENDA_BOOTSTRAP_EMAIL ?? "").trim().toLowerCase();
const name = String(args.name ?? process.env.AGENDA_BOOTSTRAP_NAME ?? "Administrador Master").trim();
const password = String(args.password ?? process.env.AGENDA_BOOTSTRAP_PASSWORD ?? "");

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("Informe --email com um e-mail válido.");
if (!name || name.length > 120) fail("Informe --name com até 120 caracteres.");
if (password.length < 12 || password.length > 128) fail("A senha inicial deve ter entre 12 e 128 caracteres.");

const salt = randomBytes(16);
const derived = pbkdf2Sync(password, salt, 600_000, 32, "sha256");
const passwordHash = `pbkdf2_sha256$600000$${salt.toString("base64url")}$${derived.toString("base64url")}`;
const userId = randomUUID();
const adminId = `platform_admin_${randomUUID()}`;
const sql = bootstrapSql({ email, name, passwordHash, userId, adminId });

if (args.remote) {
  const database = String(args.database ?? process.env.D1_DATABASE_NAME ?? "").trim();
  if (!database) fail("Para --remote, informe --database <nome-do-d1> ou D1_DATABASE_NAME.");
  await runRemote(database, sql);
} else {
  await runLocal(sql);
}

console.log(`Administrador master configurado para ${email}.`);
console.log("A senha não foi gravada em texto puro e pode ser usada em /login.");

async function runLocal(sqlText) {
  const directory = resolve(process.cwd(), ".wrangler/state/v3/d1/miniflare-D1DatabaseObject");
  let files;
  try {
    files = (await readdir(directory)).filter((name) => name.endsWith(".sqlite") && name !== "metadata.sqlite");
  } catch {
    fail("Banco D1 local não encontrado. Execute `npm run dev` uma vez e depois `npm run db:migrate:local`.");
  }
  if (files.length !== 1) fail("Não foi possível identificar unicamente o banco D1 local.");
  const database = new DatabaseSync(resolve(directory, files[0]));
  try {
    database.exec("PRAGMA foreign_keys = ON");
    const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();
    if (!tables) fail("A migration de autenticação ainda não foi aplicada. Execute `npm run db:migrate:local` primeiro.");
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(sqlText);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  } finally {
    database.close();
  }
}

async function runRemote(database, sqlText) {
  const directory = await mkdtemp(join(tmpdir(), "agenda-bootstrap-"));
  const file = join(directory, "bootstrap.sql");
  try {
    await writeFile(file, sqlText, { mode: 0o600 });
    const executable = process.platform === "win32" ? "npx.cmd" : "npx";
    const result = spawnSync(executable, ["wrangler", "d1", "execute", database, "--remote", "--file", file], {
      cwd: process.cwd(),
      stdio: "inherit",
      env: process.env,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function bootstrapSql(values) {
  const email = quote(values.email);
  const name = quote(values.name);
  const hash = quote(values.passwordHash);
  const userId = quote(values.userId);
  const adminId = quote(values.adminId);
  return `
INSERT INTO users (id, email, display_name, password_hash, is_active, must_change_password, failed_login_attempts, password_changed_at)
VALUES (${userId}, ${email}, ${name}, ${hash}, 1, 0, 0, CURRENT_TIMESTAMP)
ON CONFLICT(email) DO UPDATE SET
  display_name = excluded.display_name,
  password_hash = excluded.password_hash,
  is_active = 1,
  must_change_password = 0,
  failed_login_attempts = 0,
  locked_until = NULL,
  password_changed_at = CURRENT_TIMESTAMP,
  updated_at = CURRENT_TIMESTAMP;

UPDATE platform_admins
SET user_id = (SELECT id FROM users WHERE email = ${email}),
    display_name = ${name}, is_active = 1, updated_at = CURRENT_TIMESTAMP
WHERE email = ${email};

UPDATE platform_admins
SET user_id = (SELECT id FROM users WHERE email = ${email}),
    email = ${email}, display_name = ${name}, is_active = 1, updated_at = CURRENT_TIMESTAMP
WHERE id = 'platform_admin_seed' AND user_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM platform_admins WHERE email = ${email});

INSERT INTO platform_admins (id, user_id, email, display_name, is_active)
SELECT ${adminId}, (SELECT id FROM users WHERE email = ${email}), ${email}, ${name}, 1
WHERE NOT EXISTS (
  SELECT 1 FROM platform_admins
  WHERE user_id = (SELECT id FROM users WHERE email = ${email})
);
`;
}

function quote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function parseArgs(items) {
  const parsed = {};
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item === "--remote") { parsed.remote = true; continue; }
    if (item.startsWith("--")) {
      const key = item.slice(2);
      const value = items[index + 1];
      if (!value || value.startsWith("--")) fail(`Faltou valor para ${item}.`);
      parsed[key] = value;
      index += 1;
    }
  }
  return parsed;
}

function fail(message) {
  console.error(message);
  process.exit(2);
}
