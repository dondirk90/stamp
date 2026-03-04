const fs = require("fs");
const path = require("path");

function isPlainObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function splitSqlStatements(sql) {
  // Very small helper: split on semicolons that end statements.
  // Good enough for our migrations (no semicolons inside strings).
  return String(sql)
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function compileSqlForPostgres(sql) {
  const raw = String(sql);

  // Named params: @foo
  const namedMatches = raw.match(/@\w+/g);
  if (namedMatches && namedMatches.length) {
    const names = [];
    const seen = new Set();
    let out = raw.replace(/@\w+/g, (m) => {
      const name = m.slice(1);
      if (!seen.has(name)) {
        seen.add(name);
        names.push(name);
      }
      const idx = names.indexOf(name) + 1;
      return `$${idx}`;
    });

    return {
      text: out,
      mode: "named",
      names,
    };
  }

  // Positional params: ?
  let i = 0;
  const out = raw.replace(/\?/g, () => {
    i += 1;
    return `$${i}`;
  });
  return {
    text: out,
    mode: "positional",
    count: i,
  };
}

function normalizeArgs(args) {
  if (!args || args.length === 0) return null;
  if (args.length === 1 && isPlainObject(args[0])) return args[0];
  if (args.length === 1 && Array.isArray(args[0])) return args[0];
  return Array.from(args);
}

function createPostgresDb(databaseUrl) {
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: databaseUrl });

  async function exec(sql) {
    const statements = splitSqlStatements(sql);
    for (const s of statements) {
      await pool.query(s);
    }
  }

  function prepare(sql) {
    const compiled = compileSqlForPostgres(sql);

    async function queryRows(params) {
      if (compiled.mode === "named") {
        if (!params || !isPlainObject(params)) {
          throw new Error("Expected named parameters object");
        }
        const values = compiled.names.map((n) => params[n]);
        return pool.query(compiled.text, values);
      }

      // positional
      if (params == null) return pool.query(compiled.text);
      if (Array.isArray(params)) return pool.query(compiled.text, params);
      // allow single primitive
      return pool.query(compiled.text, [params]);
    }

    return {
      get: async (...args) => {
        const params = normalizeArgs(args);
        const res = await queryRows(params);
        return res.rows && res.rows.length ? res.rows[0] : undefined;
      },
      all: async (...args) => {
        const params = normalizeArgs(args);
        const res = await queryRows(params);
        return res.rows || [];
      },
      run: async (...args) => {
        const params = normalizeArgs(args);
        const res = await queryRows(params);
        const returnedId =
          res &&
          res.rows &&
          res.rows.length === 1 &&
          res.rows[0] &&
          res.rows[0].id != null
            ? res.rows[0].id
            : null;
        return {
          changes: res.rowCount || 0,
          ...(returnedId != null ? { lastInsertRowid: returnedId } : {}),
        };
      },
    };
  }

  return {
    client: "postgres",
    exec,
    pragma: () => {},
    prepare,
    close: async () => {
      await pool.end();
    },
  };
}

function createSqliteDb(sqlitePath) {
  const Database = require("better-sqlite3");
  const db = new Database(sqlitePath);
  db.pragma("journal_mode = WAL");
  return {
    client: "sqlite",
    exec: (sql) => db.exec(sql),
    pragma: (s) => db.pragma(s),
    prepare: (sql) => db.prepare(sql),
    close: () => {
      try {
        db.close();
      } catch {}
    },
  };
}

function createDb() {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    return createPostgresDb(databaseUrl);
  }

  const sqlitePath = path.join(__dirname, "../data/stamps.db");
  return createSqliteDb(sqlitePath);
}

module.exports = {
  createDb,
};
