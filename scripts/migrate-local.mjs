import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const migrationsDirectory = resolve(process.cwd(), "drizzle");
const localDatabaseDirectory = resolve(process.cwd(), ".wrangler/state/v3/d1/miniflare-D1DatabaseObject");
let databaseFiles;
try {
  databaseFiles = (await readdir(localDatabaseDirectory))
    .filter((name) => name.endsWith(".sqlite") && name !== "metadata.sqlite");
} catch (error) {
  if (error instanceof Error && "code" in error && error.code === "ENOENT") {
    throw new Error("Inicie `npm run dev` uma vez antes da migração local para criar o banco D1.");
  }
  throw error;
}

if (databaseFiles.length !== 1) {
  throw new Error("Inicie `npm run dev` uma vez antes da migração local para criar o banco D1.");
}

const migrationFiles = (await readdir(migrationsDirectory))
  .filter((name) => /^\d+.*\.sql$/.test(name))
  .sort();
const database = new DatabaseSync(resolve(localDatabaseDirectory, databaseFiles[0]));

try {
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("CREATE TABLE IF NOT EXISTS _local_migrations (name TEXT PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
  const findMigration = database.prepare("SELECT name FROM _local_migrations WHERE name = ? LIMIT 1");
  const saveMigration = database.prepare("INSERT INTO _local_migrations (name) VALUES (?)");

  for (const name of migrationFiles) {
    if (findMigration.get(name)) continue;
    const sql = await readFile(resolve(migrationsDirectory, name), "utf8");
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(sql.replaceAll("--> statement-breakpoint", ""));
      saveMigration.run(name);
      database.exec("COMMIT");
      console.log(`Migração local aplicada: ${name}`);
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
} finally {
  database.close();
}
