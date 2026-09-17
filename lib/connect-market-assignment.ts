import { getPool } from "@/lib/db";

const REGION_TO_MARKET: Record<string, string> = {
  "chicago-core": "chicago",
  "chicago-suburbs": "chicago",
  "northwest-indiana": "chicago",
  "indianapolis": "indianapolis",
  "milwaukee": "milwaukee",
  "metro-east-southern": "st-louis",
  "austin": "austin",
  "san-antonio": "san-antonio",
  "nashville": "nashville",
  "baltimore": "baltimore",
  "pittsburgh": "pittsburgh",
  "las-vegas": "las-vegas",
  "sacramento": "sacramento",
  "kansas-city": "kansas-city",
  "columbus": "columbus",
  "cleveland": "cleveland",
  "cincinnati": "cincinnati",
  "jacksonville": "jacksonville",
  "richmond": "richmond",
  "salt-lake-city": "salt-lake-city",
  "new-orleans": "new-orleans"
};

const CITY_TO_MARKET: Record<string, string> = {
  "new york": "new-york-city",
  "new york city": "new-york-city",
  "los angeles": "los-angeles",
  "chicago": "chicago",
  "dallas": "dallas-fort-worth",
  "fort worth": "dallas-fort-worth",
  "houston": "houston",
  "washington": "washington-dc",
  "washington dc": "washington-dc",
  "miami": "miami-fort-lauderdale",
  "fort lauderdale": "miami-fort-lauderdale",
  "philadelphia": "philadelphia",
  "atlanta": "atlanta",
  "phoenix": "phoenix",
  "boston": "boston",
  "san francisco": "san-francisco-bay-area",
  "oakland": "san-francisco-bay-area",
  "san jose": "san-francisco-bay-area",
  "seattle": "seattle",
  "denver": "denver",
  "detroit": "detroit",
  "minneapolis": "minneapolis-st-paul",
  "saint paul": "minneapolis-st-paul",
  "st paul": "minneapolis-st-paul",
  "tampa": "tampa-bay",
  "st petersburg": "tampa-bay",
  "saint petersburg": "tampa-bay",
  "san diego": "san-diego",
  "orlando": "orlando",
  "charlotte": "charlotte",
  "austin": "austin",
  "san antonio": "san-antonio",
  "nashville": "nashville",
  "raleigh": "raleigh-durham",
  "durham": "raleigh-durham",
  "st louis": "st-louis",
  "saint louis": "st-louis",
  "baltimore": "baltimore",
  "pittsburgh": "pittsburgh",
  "portland": "portland",
  "las vegas": "las-vegas",
  "sacramento": "sacramento",
  "kansas city": "kansas-city",
  "columbus": "columbus",
  "indianapolis": "indianapolis",
  "cleveland": "cleveland",
  "cincinnati": "cincinnati",
  "milwaukee": "milwaukee",
  "jacksonville": "jacksonville",
  "richmond": "richmond",
  "salt lake city": "salt-lake-city",
  "new orleans": "new-orleans"
};

const STATE_NAMES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO",
  connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID",
  illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA",
  maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR",
  pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD",
  tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA",
  "west virginia": "WV", wisconsin: "WI", wyoming: "WY", "district of columbia": "DC"
};

function normalize(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSlug(value: string | null | undefined) {
  return normalize(value).replace(/\s+/g, "-");
}

function stateCode(value: string | null | undefined) {
  const clean = (value ?? "").trim();
  if (/^[A-Za-z]{2}$/.test(clean)) return clean.toUpperCase();
  return STATE_NAMES[normalize(clean)] ?? null;
}

function marketSlugFromHints(input: {
  explicitMarketSlug?: string | null;
  discoveryRegion?: string | null;
  city?: string | null;
  state?: string | null;
}) {
  const explicit = normalizeSlug(input.explicitMarketSlug);
  if (explicit) return { slug: explicit, method: "EXPLICIT_MARKET" as const };

  const region = normalizeSlug(input.discoveryRegion);
  if (region && REGION_TO_MARKET[region]) {
    return { slug: REGION_TO_MARKET[region], method: "DISCOVERY_REGION" as const };
  }

  const city = normalize(input.city);
  if (city && CITY_TO_MARKET[city]) {
    return { slug: CITY_TO_MARKET[city], method: "CITY_ALIAS" as const };
  }

  const state = stateCode(input.state);
  if (state) return { slug: `state-${state.toLowerCase()}`, method: "STATE_BACKFILL" as const };
  return { slug: "united-states", method: "NATIONAL_BACKFILL" as const };
}

export async function assignProspectToResearchMarket(
  prospectId: string,
  hints: {
    explicitMarketSlug?: string | null;
    discoveryRegion?: string | null;
    city?: string | null;
    state?: string | null;
  } = {}
) {
  const pool = getPool();
  const current = await pool.query(
    `SELECT id,city,state,market_id,source_metadata FROM connect_prospects WHERE id=$1 LIMIT 1`,
    [prospectId]
  );
  const prospect = current.rows[0];
  if (!prospect) return { assigned: false, reason: "PROSPECT_NOT_FOUND" as const };
  if (prospect.market_id) return { assigned: false, reason: "ALREADY_ASSIGNED" as const, marketId: String(prospect.market_id) };

  const metadata = prospect.source_metadata && typeof prospect.source_metadata === "object"
    ? prospect.source_metadata as Record<string, unknown>
    : {};
  const discoveryRegion = hints.discoveryRegion
    ?? (typeof metadata.discovery_region === "string" ? metadata.discovery_region : null);
  const selected = marketSlugFromHints({
    explicitMarketSlug: hints.explicitMarketSlug,
    discoveryRegion,
    city: hints.city ?? prospect.city,
    state: hints.state ?? prospect.state
  });

  const market = await pool.query(
    `SELECT id,slug,name,market_type,status
     FROM connect_research_markets
     WHERE slug=$1 AND status IN ('PLANNED','ACTIVE','PAUSED','COMPLETE')
     LIMIT 1`,
    [selected.slug]
  );
  if (!market.rows[0]) return { assigned: false, reason: "MARKET_NOT_FOUND" as const, marketSlug: selected.slug };

  await pool.query(
    `UPDATE connect_prospects
     SET market_id=$2,
         source_metadata=coalesce(source_metadata,'{}'::jsonb) || $3::jsonb,
         updated_at=now()
     WHERE id=$1 AND market_id IS NULL`,
    [prospectId, market.rows[0].id, JSON.stringify({
      research_market_assignment: {
        market_id: market.rows[0].id,
        market_slug: market.rows[0].slug,
        market_name: market.rows[0].name,
        market_type: market.rows[0].market_type,
        assignment_method: selected.method,
        assigned_at: new Date().toISOString()
      }
    })]
  );

  return {
    assigned: true,
    marketId: String(market.rows[0].id),
    marketSlug: String(market.rows[0].slug),
    marketType: String(market.rows[0].market_type),
    method: selected.method
  };
}

export async function backfillProspectResearchMarkets(clientId: string, limit = 1000) {
  const safeLimit = Math.max(1, Math.min(5000, Math.floor(limit || 1000)));
  const { rows } = await getPool().query(
    `SELECT id,city,state,source_metadata
     FROM connect_prospects
     WHERE client_id=$1 AND country='US' AND market_id IS NULL
     ORDER BY created_at DESC
     LIMIT $2`,
    [clientId, safeLimit]
  );

  const result = {
    attempted: 0,
    assigned: 0,
    metro: 0,
    state: 0,
    national: 0,
    alreadyAssigned: 0,
    unresolved: 0
  };

  for (const row of rows) {
    result.attempted++;
    const metadata = row.source_metadata && typeof row.source_metadata === "object"
      ? row.source_metadata as Record<string, unknown>
      : {};
    const assigned = await assignProspectToResearchMarket(String(row.id), {
      discoveryRegion: typeof metadata.discovery_region === "string" ? metadata.discovery_region : null,
      city: row.city ? String(row.city) : null,
      state: row.state ? String(row.state) : null
    });
    if (assigned.assigned) {
      result.assigned++;
      if (assigned.marketType === "METRO") result.metro++;
      else if (assigned.marketType === "STATE") result.state++;
      else if (assigned.marketType === "NATIONAL") result.national++;
    } else if (assigned.reason === "ALREADY_ASSIGNED") {
      result.alreadyAssigned++;
    } else {
      result.unresolved++;
    }
  }
  return result;
}
