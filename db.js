const { Pool } = require("pg");

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || "";

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

const isRailway =
  connectionString.includes("railway.app") || Boolean(process.env.RAILWAY_ENVIRONMENT);

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
