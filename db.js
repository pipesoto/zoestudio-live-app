const { Pool } = require("pg");

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || "";
const hasTemplateLiteralRef =
  connectionString.startsWith("${{") && connectionString.endsWith("}}");

if (!connectionString) {
  const hasPgDiscreteVars =
    Boolean(process.env.PGHOST) &&
    Boolean(process.env.PGUSER) &&
    Boolean(process.env.PGPASSWORD) &&
    Boolean(process.env.PGDATABASE);

  if (!hasPgDiscreteVars) {
    throw new Error(
      "No se encontro configuracion de PostgreSQL. Define DATABASE_URL (o POSTGRES_URL) en Railway."
    );
  }
}

if (hasTemplateLiteralRef) {
  throw new Error(
    "DATABASE_URL parece no resuelta por Railway (quedo como ${{...}}). Revisa Reference Variable y redeploy."
  );
}

const isRailway =
  connectionString.includes("railway.app") || Boolean(process.env.RAILWAY_ENVIRONMENT);

if (process.env.DEBUG_ENV === "true") {
  console.log("[debug-env] DATABASE_URL:", Boolean(process.env.DATABASE_URL));
  console.log("[debug-env] POSTGRES_URL:", Boolean(process.env.POSTGRES_URL));
  console.log("[debug-env] PGHOST:", Boolean(process.env.PGHOST));
  console.log("[debug-env] PGUSER:", Boolean(process.env.PGUSER));
  console.log("[debug-env] PGDATABASE:", Boolean(process.env.PGDATABASE));
}

const pool = new Pool({
  connectionString: connectionString || undefined,
  host: process.env.PGHOST,
  port: process.env.PGPORT ? Number(process.env.PGPORT) : undefined,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  ssl: isRailway ? { rejectUnauthorized: false } : false
});

module.exports = pool;
