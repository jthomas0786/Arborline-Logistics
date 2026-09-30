import { getPool } from "@/lib/db";

const HARD_MISS_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const GOOD_ROUTE_TTL_MS = 180 * 24 * 60 * 60 * 1000;
const MAX_PREFERRED_PATHS = 8;

export type ConnectResearchRouteMemory = {
  deadPaths: Set<string>;
  preferredPaths: string[];
};

export type ConnectResearchRouteOutcome = {
  url: string;
  ok: boolean;
  status: number | null;
};

export type AdaptiveResearchSeeds = {
  urls: string[];
  skippedKnownDead: number;
  rememberedGoodPrioritized: number;
};

export const EMPTY_CONNECT_RESEARCH_ROUTE_MEMORY: ConnectResearchRouteMemory = {
  deadPaths: new Set<string>(),
  preferredPaths: []
};

function normalizeDomain(value: string) {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].split(":")[0];
}

export function normalizeResearchRoutePath(value: string) {
  try {
    const path = new URL(value, "https://route-memory.invalid").pathname || "/";
    return path === "/" ? "/" : path.replace(/\/+$/, "") || "/";
  } catch {
    const path = value.trim().startsWith("/") ? value.trim() : `/${value.trim()}`;
    return path === "/" ? "/" : path.replace(/\/+$/, "") || "/";
  }
}

function pathForUrl(value: string) {
  try {
    return normalizeResearchRoutePath(new URL(value).pathname);
  } catch {
    return normalizeResearchRoutePath(value);
  }
}

export function shouldSkipRememberedDeadRoute(url: string, memory: ConnectResearchRouteMemory) {
  const path = pathForUrl(url);
  return path !== "/" && memory.deadPaths.has(path);
}

export function buildAdaptiveResearchSeeds(
  domainValue: string,
  basePaths: string[],
  memory: ConnectResearchRouteMemory
): AdaptiveResearchSeeds {
  const domain = normalizeDomain(domainValue);
  const seen = new Set<string>();
  const urls: string[] = [];
  let skippedKnownDead = 0;
  let rememberedGoodPrioritized = 0;

  const add = (pathValue: string, rememberedGood = false) => {
    const path = normalizeResearchRoutePath(pathValue);
    if (path !== "/" && memory.deadPaths.has(path)) {
      skippedKnownDead++;
      return;
    }
    if (seen.has(path)) return;
    seen.add(path);
    urls.push(`https://${domain}${path === "/" ? "/" : path}`);
    if (rememberedGood && path !== "/") rememberedGoodPrioritized++;
  };

  // Root is always rechecked so site redesigns and newly linked pages remain discoverable.
  add("/");
  for (const path of memory.preferredPaths.slice(0, MAX_PREFERRED_PATHS)) add(path, true);
  for (const path of basePaths) add(path);

  return { urls, skippedKnownDead, rememberedGoodPrioritized };
}

export async function loadConnectResearchRouteMemory(domainValue: string): Promise<ConnectResearchRouteMemory> {
  const domain = normalizeDomain(domainValue);
  if (!domain) return { deadPaths: new Set<string>(), preferredPaths: [] };

  try {
    const { rows } = await getPool().query(
      `SELECT path,last_status,consecutive_hard_misses,last_checked_at,last_success_at
       FROM public.connect_research_route_memory
       WHERE domain=$1
       ORDER BY last_success_at DESC NULLS LAST,last_checked_at DESC
       LIMIT 100`,
      [domain]
    );
    const now = Date.now();
    const deadPaths = new Set<string>();
    const preferredPaths: string[] = [];

    for (const row of rows) {
      const path = normalizeResearchRoutePath(String(row.path || "/"));
      const checkedAt = row.last_checked_at ? new Date(row.last_checked_at).getTime() : 0;
      const successAt = row.last_success_at ? new Date(row.last_success_at).getTime() : 0;
      const status = Number(row.last_status || 0);
      const hardMisses = Number(row.consecutive_hard_misses || 0);

      if (path !== "/" && hardMisses > 0 && (status === 404 || status === 410) && checkedAt > 0 && now - checkedAt <= HARD_MISS_TTL_MS) {
        deadPaths.add(path);
      }
      if (path !== "/" && successAt > 0 && now - successAt <= GOOD_ROUTE_TTL_MS && !preferredPaths.includes(path)) {
        preferredPaths.push(path);
      }
    }

    return { deadPaths, preferredPaths: preferredPaths.slice(0, MAX_PREFERRED_PATHS) };
  } catch {
    // Route memory is an optimization only. Research must keep working if the
    // memory table is temporarily unavailable or a deployment races a migration.
    return { deadPaths: new Set<string>(), preferredPaths: [] };
  }
}

export async function persistConnectResearchRouteOutcomes(domainValue: string, outcomes: ConnectResearchRouteOutcome[]) {
  const domain = normalizeDomain(domainValue);
  if (!domain || !outcomes.length) return 0;

  const byPath = new Map<string, { path: string; status: number }>();
  for (const outcome of outcomes) {
    const path = pathForUrl(outcome.url);
    if (outcome.ok) {
      // A successful route always wins over a hard miss observed for the same
      // normalized path in the current run.
      byPath.set(path, { path, status: 200 });
      continue;
    }
    if ((outcome.status === 404 || outcome.status === 410) && byPath.get(path)?.status !== 200) {
      byPath.set(path, { path, status: outcome.status });
    }
  }
  if (!byPath.size) return 0;

  try {
    const payload = [...byPath.values()];
    const result = await getPool().query(
      `WITH incoming AS (
         SELECT path,status
         FROM jsonb_to_recordset($2::jsonb) AS x(path text,status integer)
       )
       INSERT INTO public.connect_research_route_memory
         (domain,path,last_status,consecutive_hard_misses,success_count,last_checked_at,last_success_at,updated_at)
       SELECT $1,
              incoming.path,
              incoming.status,
              CASE WHEN incoming.status IN (404,410) THEN 1 ELSE 0 END,
              CASE WHEN incoming.status BETWEEN 200 AND 399 THEN 1 ELSE 0 END,
              now(),
              CASE WHEN incoming.status BETWEEN 200 AND 399 THEN now() ELSE NULL END,
              now()
       FROM incoming
       ON CONFLICT (domain,path) DO UPDATE
       SET last_status=EXCLUDED.last_status,
           consecutive_hard_misses=CASE
             WHEN EXCLUDED.last_status IN (404,410)
               THEN public.connect_research_route_memory.consecutive_hard_misses + 1
             ELSE 0
           END,
           success_count=CASE
             WHEN EXCLUDED.last_status BETWEEN 200 AND 399
               THEN public.connect_research_route_memory.success_count + 1
             ELSE public.connect_research_route_memory.success_count
           END,
           last_checked_at=now(),
           last_success_at=CASE
             WHEN EXCLUDED.last_status BETWEEN 200 AND 399 THEN now()
             ELSE public.connect_research_route_memory.last_success_at
           END,
           updated_at=now()
       RETURNING path`,
      [domain, JSON.stringify(payload)]
    );
    return result.rowCount ?? 0;
  } catch {
    return 0;
  }
}
