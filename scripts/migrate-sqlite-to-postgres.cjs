#!/usr/bin/env node

const path = require("path");

function parseArgs(argv) {
  const args = new Set(argv.slice(2));
  return {
    yes: args.has("--yes") || args.has("-y"),
    force: args.has("--force"),
    dryRun: args.has("--dry-run"),
    sqlitePath: (() => {
      const idx = argv.indexOf("--sqlite");
      if (idx !== -1 && argv[idx + 1]) return argv[idx + 1];
      return path.join(__dirname, "../data/stamps.db");
    })(),
  };
}

function qident(name) {
  // Quote identifiers for Postgres
  return `"${String(name).replace(/"/g, '""')}"`;
}

function buildInsertSql(table, columns, conflictTarget) {
  const colsSql = columns.map(qident).join(", ");
  const paramsSql = columns.map((_, i) => `$${i + 1}`).join(", ");
  const conflictSql = conflictTarget
    ? ` ON CONFLICT (${conflictTarget.map(qident).join(", ")}) DO NOTHING`
    : "";
  return `INSERT INTO ${qident(table)} (${colsSql}) VALUES (${paramsSql})${conflictSql}`;
}

async function main() {
  const args = parseArgs(process.argv);

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("Missing DATABASE_URL. Refusing to run.");
    process.exit(1);
  }

  const sqlitePath = path.resolve(args.sqlitePath);

  const Database = require("better-sqlite3");
  const { Pool } = require("pg");

  const sqlite = new Database(sqlitePath, { readonly: true });
  const pg = new Pool({ connectionString: databaseUrl });

  const tables = [
    {
      name: "cafes",
      conflict: ["id"],
      columns: [
        "id",
        "name",
        "email",
        "address",
        "location_address",
        "street",
        "house_number",
        "postal_code",
        "city",
        "country",
        "lat",
        "lng",
        "password_hash",
        "about_text",
        "redeem_message",
        "logo_mime",
        "logo_data",
        "updated_at",
        "created_at",
      ],
    },
    {
      name: "customers",
      conflict: ["id"],
      columns: [
        "id",
        "customer_id",
        "username",
        "email",
        "address",
        "encrypted_key",
        "password_hash",
        "created_at",
      ],
    },
    {
      name: "cafe_images",
      conflict: ["id"],
      columns: ["id", "cafe_id", "mime", "data_b64", "created_at"],
    },
    {
      name: "cafe_sessions",
      conflict: ["id"],
      columns: ["id", "cafe_id", "token_hash", "created_at", "expires_at"],
    },
    {
      name: "customer_password_resets",
      conflict: ["id"],
      columns: [
        "id",
        "customer_id",
        "token_hash",
        "created_at",
        "expires_at",
        "used_at",
      ],
    },
    {
      name: "qr_nonces",
      conflict: ["nonce"],
      columns: ["nonce", "cafe_id", "expires", "consumed", "consumed_at"],
      // SQLite columns already match these names
      sqliteSelect:
        "SELECT nonce, cafe_id, expires, consumed, consumed_at FROM qr_nonces",
    },
    {
      name: "redeem_tokens",
      conflict: ["token"],
      columns: [
        "token",
        "created_at",
        "used_at",
        "cafe",
        "user",
        "used_by_cafe",
        "used_txhash",
      ],
      sqliteSelect:
        "SELECT token, created_at, used_at, cafe, user, used_by_cafe, used_txhash FROM redeem_tokens",
    },
    {
      name: "sync_state",
      conflict: ["key"],
      columns: ["key", "value"],
    },
    {
      name: "stamp_events",
      conflict: ["id"],
      columns: [
        "id",
        "ts",
        "cafe",
        "user",
        "customer_name",
        "event_type",
        "delta",
        "txhash",
        "status",
      ],
    },
  ];

  function sqliteTableExists(name) {
    const row = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
      .get(name);
    return !!row;
  }

  function readAllRows(tableName, columns) {
    if (!sqliteTableExists(tableName)) return [];
    const tableSpec = tables.find((t) => t.name === tableName) || null;
    if (tableSpec && tableSpec.sqliteSelect) {
      return sqlite.prepare(String(tableSpec.sqliteSelect)).all();
    }
    const colsSql = columns.map((c) => `"${c}"`).join(", ");
    return sqlite.prepare(`SELECT ${colsSql} FROM "${tableName}"`).all();
  }

  async function pgCount(tableName) {
    const res = await pg.query(
      `SELECT COUNT(1)::bigint as n FROM ${qident(tableName)}`,
    );
    return Number(res.rows?.[0]?.n ?? 0);
  }

  try {
    const counts = {};
    for (const t of tables) {
      counts[t.name] = sqliteTableExists(t.name)
        ? sqlite.prepare(`SELECT COUNT(1) as n FROM "${t.name}"`).get().n
        : 0;
    }

    console.log("SQLite source:", sqlitePath);
    console.table(counts);

    const existingCafes = await pgCount("cafes");
    if (existingCafes > 0 && !args.force) {
      console.error(
        `Target Postgres already has data (cafes=${existingCafes}). Use --force to attempt merge (ON CONFLICT DO NOTHING).`,
      );
      process.exit(1);
    }

    if (!args.yes && !args.dryRun) {
      console.log(
        "\nAbout to copy data from SQLite to Postgres. Re-run with --yes to proceed, or --dry-run to only print counts.",
      );
      process.exit(2);
    }

    if (args.dryRun) {
      console.log("Dry run: not importing.");
      process.exit(0);
    }

    const client = await pg.connect();
    try {
      await client.query("BEGIN");

      for (const t of tables) {
        const rows = readAllRows(t.name, t.columns);
        if (!rows.length) continue;

        // For Postgres reserved word column name: stamp_events.user
        const colsForPg = t.columns.map((c) =>
          t.name === "stamp_events" && c === "user" ? "user" : c,
        );
        const insertSql = buildInsertSql(t.name, colsForPg, t.conflict);

        for (const row of rows) {
          const values = t.columns.map((c) => row[c]);
          await client.query(insertSql, values);
        }

        console.log(`Imported ${rows.length} row(s) into ${t.name}`);
      }

      // Fix sequences for serial IDs
      const seqFixes = [
        { table: "cafes", col: "id", seq: "cafes_id_seq" },
        { table: "customers", col: "id", seq: "customers_id_seq" },
        { table: "cafe_images", col: "id", seq: "cafe_images_id_seq" },
        { table: "cafe_sessions", col: "id", seq: "cafe_sessions_id_seq" },
        {
          table: "customer_password_resets",
          col: "id",
          seq: "customer_password_resets_id_seq",
        },
        { table: "stamp_events", col: "id", seq: "stamp_events_id_seq" },
      ];

      for (const f of seqFixes) {
        try {
          await client.query(
            `SELECT setval($1, COALESCE((SELECT MAX(${qident(f.col)}) FROM ${qident(
              f.table,
            )}), 0) + 1, false)`,
            [f.seq],
          );
        } catch (e) {
          // ignore if sequence name differs or table doesn't exist
        }
      }

      await client.query("COMMIT");
      console.log("\nDone. Postgres now contains the migrated data.");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  } finally {
    try {
      sqlite.close();
    } catch {}
    try {
      await pg.end();
    } catch {}
  }
}

main().catch((err) => {
  console.error("Migration failed:", err && err.stack ? err.stack : err);
  process.exit(1);
});
