import { Pool, type PoolConfig } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var arborlinePool: Pool | undefined;
}

function poolConfig(): PoolConfig {
  const discreteReady = Boolean(
    process.env.PGHOST &&
    process.env.PGUSER &&
    process.env.PGPASSWORD &&
    process.env.PGDATABASE
  );

  if (discreteReady) {
    return {
      host: process.env.PGHOST,
      port: Number(process.env.PGPORT || 5432),
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE,
      ssl: { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    };
  }

  if (!process.env.DATABASE_URL) {
    throw new Error("Database connection is not configured");
  }

  return {
    connectionString: process.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  };
}

export function getPool(): Pool {
  if (!global.arborlinePool) {
    global.arborlinePool = new Pool(poolConfig());
  }
  return global.arborlinePool;
}
