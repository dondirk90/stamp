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

async function getAppliedMigrations(client) {
  const res = await client.query("SELECT id FROM schema_migrations");
  return new Set(res.rows.map((r) => String(r.id)));
}

async function applyMigration(client, id, sql) {
  await client.query("BEGIN");
  try {
    await client.query(sql);
    await client.query(
      "INSERT INTO schema_migrations (id, applied_at) VALUES ($1, $2)",
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

    const applied = await getAppliedMigrations(client);
    const migrations = listMigrationFiles();

    let ran = 0;
    for (const m of migrations) {
      if (applied.has(m.id)) continue;
      const sql = fs.readFileSync(m.filePath, "utf8");
      console.log(`Applying migration ${m.id}...`);
      await applyMigration(client, m.id, sql);
      ran++;
    }

    console.log(`Migrations complete. Applied ${ran} new migration(s).`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error("Migration failed:", e && e.stack ? e.stack : e);
  process.exit(1);
});
