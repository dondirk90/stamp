const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

function mustGetEnv(key) {
  const v = process.env[key];
  if (!v) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return v;
}

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at BIGINT NOT NULL
    );
  `);
}

function listMigrationFiles() {
  const dir = path.join(__dirname, "migrations");
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^\d+_.+\.sql$/i.test(f))
    .sort();
  return files.map((f) => ({ id: f, filePath: path.join(dir, f) }));
}

// Every migration file must stay written with IF NOT EXISTS / ADD COLUMN IF
// NOT EXISTS guards (all of them are, as of writing) - that's what makes it
// safe to unconditionally re-apply every file on every deploy below, instead
// of trusting schema_migrations bookkeeping to say a file is already done.
// A restored/rebuilt DB volume can have that bookkeeping without the actual
// schema changes (this happened once in prod: schema_migrations said
// migration 007 was applied, but customers.avatar_mime didn't exist) - so
// re-running is the safety net, not just an optimization to skip.
async function applyMigration(client, id, sql) {
  await client.query("BEGIN");
  try {
    await client.query(sql);
    await client.query(
      "INSERT INTO schema_migrations (id, applied_at) VALUES ($1, $2) " +
        "ON CONFLICT (id) DO UPDATE SET applied_at = EXCLUDED.applied_at",
      [id, Date.now()]
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  }
}

async function main() {
  const databaseUrl = mustGetEnv("DATABASE_URL");

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await ensureMigrationsTable(client);

    const migrations = listMigrationFiles();

    for (const m of migrations) {
      const sql = fs.readFileSync(m.filePath, "utf8");
      console.log(`Applying migration ${m.id}...`);
      await applyMigration(client, m.id, sql);
    }

    console.log(`Migrations complete. Re-applied ${migrations.length} migration(s) (idempotent).`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error("Migration failed:", e && e.stack ? e.stack : e);
  process.exit(1);
});
