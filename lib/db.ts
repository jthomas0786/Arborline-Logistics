import { Pool } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var arborlinePool: Pool | undefined;
}

export function getPool(): Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured");
  }

  if (!global.arborlinePool) {
    global.arborlinePool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
    });
  }

  return global.arborlinePool;
}
