import { getPool } from "@/lib/db";

export type ResearchMarketDefinition = {
  slug: string;
  name: string;
  marketType: "METRO" | "STATE" | "NATIONAL";
  stateCodes: string[];
  tier: 1 | 2 | 3 | 4;
  priority: number;
  geography: Record<string, unknown>;
};

const TIER_ONE_METROS: Array<[string, string, string[]]> = [
  ["new-york-city", "New York City", ["NY", "NJ", "CT"]],
  ["los-angeles", "Los Angeles", ["CA"]],
  ["chicago", "Chicago", ["IL", "IN", "WI"]],
  ["dallas-fort-worth", "Dallas–Fort Worth", ["TX"]],
  ["houston", "Houston", ["TX"]],
  ["washington-dc", "Washington, DC", ["DC", "VA", "MD"]],
  ["miami-fort-lauderdale", "Miami–Fort Lauderdale", ["FL"]],
  ["philadelphia", "Philadelphia", ["PA", "NJ", "DE"]],
  ["atlanta", "Atlanta", ["GA"]],
  ["phoenix", "Phoenix", ["AZ"]],
  ["boston", "Boston", ["MA", "NH", "RI"]],
  ["san-francisco-bay-area", "San Francisco Bay Area", ["CA"]],
  ["seattle", "Seattle", ["WA"]],
  ["denver", "Denver", ["CO"]],
  ["detroit", "Detroit", ["MI"]],
  ["minneapolis-st-paul", "Minneapolis–St. Paul", ["MN", "WI"]],
  ["tampa-bay", "Tampa Bay", ["FL"]],
  ["san-diego", "San Diego", ["CA"]],
  ["orlando", "Orlando", ["FL"]],
  ["charlotte", "Charlotte", ["NC", "SC"]]
];

const TIER_TWO_METROS: Array<[string, string, string[]]> = [
  ["austin", "Austin", ["TX"]],
  ["san-antonio", "San Antonio", ["TX"]],
  ["nashville", "Nashville", ["TN"]],
  ["raleigh-durham", "Raleigh–Durham", ["NC"]],
  ["st-louis", "St. Louis", ["MO", "IL"]],
  ["baltimore", "Baltimore", ["MD"]],
  ["pittsburgh", "Pittsburgh", ["PA"]],
  ["portland", "Portland", ["OR", "WA"]],
  ["las-vegas", "Las Vegas", ["NV"]],
  ["sacramento", "Sacramento", ["CA"]],
  ["kansas-city", "Kansas City", ["MO", "KS"]],
  ["columbus", "Columbus", ["OH"]],
  ["indianapolis", "Indianapolis", ["IN"]],
  ["cleveland", "Cleveland", ["OH"]],
  ["cincinnati", "Cincinnati", ["OH", "KY", "IN"]],
  ["milwaukee", "Milwaukee", ["WI"]],
  ["jacksonville", "Jacksonville", ["FL"]],
  ["richmond", "Richmond", ["VA"]],
  ["salt-lake-city", "Salt Lake City", ["UT"]],
  ["new-orleans", "New Orleans", ["LA"]]
];

const US_STATES: Array<[string, string]> = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"], ["CA", "California"],
  ["CO", "Colorado"], ["CT", "Connecticut"], ["DE", "Delaware"], ["FL", "Florida"], ["GA", "Georgia"],
  ["HI", "Hawaii"], ["ID", "Idaho"], ["IL", "Illinois"], ["IN", "Indiana"], ["IA", "Iowa"],
  ["KS", "Kansas"], ["KY", "Kentucky"], ["LA", "Louisiana"], ["ME", "Maine"], ["MD", "Maryland"],
  ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"], ["MS", "Mississippi"], ["MO", "Missouri"],
  ["MT", "Montana"], ["NE", "Nebraska"], ["NV", "Nevada"], ["NH", "New Hampshire"], ["NJ", "New Jersey"],
  ["NM", "New Mexico"], ["NY", "New York"], ["NC", "North Carolina"], ["ND", "North Dakota"], ["OH", "Ohio"],
  ["OK", "Oklahoma"], ["OR", "Oregon"], ["PA", "Pennsylvania"], ["RI", "Rhode Island"], ["SC", "South Carolina"],
  ["SD", "South Dakota"], ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"], ["VT", "Vermont"],
  ["VA", "Virginia"], ["WA", "Washington"], ["WV", "West Virginia"], ["WI", "Wisconsin"], ["WY", "Wyoming"],
  ["DC", "District of Columbia"]
];

function metroDefinition([slug, name, stateCodes]: [string, string, string[]], tier: 1 | 2): ResearchMarketDefinition {
  return {
    slug,
    name,
    marketType: "METRO",
    stateCodes,
    tier,
    priority: tier === 1 ? 20 : 40,
    geography: { strategy: "METRO", aliases: [name], state_codes: stateCodes }
  };
}

export function nationalMarketCatalog(): ResearchMarketDefinition[] {
  const metros = [
    ...TIER_ONE_METROS.map((market) => metroDefinition(market, 1)),
    ...TIER_TWO_METROS.map((market) => metroDefinition(market, 2))
  ];
  const states = US_STATES.map(([code, name]): ResearchMarketDefinition => ({
    slug: `state-${code.toLowerCase()}`,
    name: `${name} statewide backfill`,
    marketType: "STATE",
    stateCodes: [code],
    tier: 4,
    priority: 200,
    geography: { strategy: "STATE_BACKFILL", state_codes: [code] }
  }));
  return [
    ...metros,
    ...states,
    {
      slug: "united-states",
      name: "United States national backfill",
      marketType: "NATIONAL",
      stateCodes: US_STATES.map(([code]) => code),
      tier: 4,
      priority: 500,
      geography: { strategy: "NATIONAL_BACKFILL", country: "US" }
    }
  ];
}

export async function ensureNationalMarketCatalog() {
  const pool = getPool();
  let created = 0;
  let existing = 0;
  for (const market of nationalMarketCatalog()) {
    const result = await pool.query(
      `INSERT INTO connect_research_markets
         (slug,name,market_type,country,state_codes,tier,priority,status,geography,metadata)
       VALUES ($1,$2,$3,'US',$4,$5,$6,'PLANNED',$7::jsonb,$8::jsonb)
       ON CONFLICT (slug) DO UPDATE
       SET name=excluded.name,market_type=excluded.market_type,state_codes=excluded.state_codes,
           tier=excluded.tier,priority=excluded.priority,geography=excluded.geography,
           metadata=connect_research_markets.metadata || excluded.metadata,updated_at=now()
       RETURNING (xmax = 0) AS inserted`,
      [
        market.slug,
        market.name,
        market.marketType,
        market.stateCodes,
        market.tier,
        market.priority,
        JSON.stringify(market.geography),
        JSON.stringify({ catalog: "ARBORLINE_US_V1" })
      ]
    );
    if (result.rows[0]?.inserted) created++;
    else existing++;
  }
  return { catalog: "ARBORLINE_US_V1", created, existing, total: created + existing, activated: 0 };
}

export async function planMarketSegments(clientId: string) {
  const pool = getPool();
  const result = await pool.query(
    `INSERT INTO connect_market_segments (client_id,market_id,segment_id,status,priority,target_prospect_count,metadata)
     SELECT $1,m.id,s.id,'PLANNED',m.priority,100,jsonb_build_object('planner','ARBORLINE_NATIONAL_V1')
     FROM connect_research_markets m
     CROSS JOIN connect_prospect_segments s
     WHERE m.status IN ('PLANNED','ACTIVE')
       AND s.client_id=$1
       AND s.status IN ('APPROVED','ACTIVE')
     ON CONFLICT (client_id,market_id,segment_id) DO NOTHING
     RETURNING id`,
    [clientId]
  );
  return { planned: result.rowCount ?? 0, activated: 0 };
}

export async function getNationalResearchCoverage(clientId: string) {
  const { rows } = await getPool().query(
    `SELECT
       m.id AS market_id,m.slug AS market_slug,m.name AS market_name,m.market_type,m.tier,m.status AS market_status,
       s.id AS segment_id,s.slug AS segment_slug,s.name AS segment_name,ms.status AS market_segment_status,
       count(p.id)::int AS prospects,
       count(p.id) FILTER (WHERE p.source_metadata->'service_fit'->>'status' IN ('MATCH','REVIEW','MISMATCH'))::int AS service_fit_checked,
       count(p.id) FILTER (WHERE p.source_metadata->'service_fit'->>'status'='MATCH')::int AS service_fit_match,
       count(p.id) FILTER (WHERE p.qualification_status='QUALIFIED')::int AS qualified,
       count(p.id) FILTER (WHERE p.contact_email IS NOT NULL)::int AS contacts,
       count(p.id) FILTER (WHERE p.outreach_status='READY')::int AS outreach_ready,
       max(p.updated_at) AS latest_prospect_update
     FROM connect_market_segments ms
     JOIN connect_research_markets m ON m.id=ms.market_id
     JOIN connect_prospect_segments s ON s.id=ms.segment_id
     LEFT JOIN connect_prospects p ON p.client_id=ms.client_id AND p.market_id=m.id AND p.segment_id=s.id
     WHERE ms.client_id=$1
     GROUP BY m.id,m.slug,m.name,m.market_type,m.tier,m.status,s.id,s.slug,s.name,ms.status
     ORDER BY m.tier ASC,ms.priority ASC,m.name ASC,s.name ASC`,
    [clientId]
  );
  return rows;
}

export async function getNationalCoordinatorSummary(clientId: string) {
  const { rows } = await getPool().query(
    `SELECT
       count(*)::int AS market_segments,
       count(*) FILTER (WHERE ms.status='ACTIVE')::int AS active_market_segments,
       count(*) FILTER (WHERE ms.status='PLANNED')::int AS planned_market_segments,
       count(DISTINCT ms.market_id)::int AS markets,
       count(DISTINCT ms.segment_id)::int AS segments,
       coalesce(sum(prospect_counts.prospects),0)::int AS prospects,
       coalesce(sum(prospect_counts.qualified),0)::int AS qualified,
       coalesce(sum(prospect_counts.verified_contacts),0)::int AS verified_contacts
     FROM connect_market_segments ms
     LEFT JOIN LATERAL (
       SELECT count(*)::int AS prospects,
              count(*) FILTER (WHERE p.qualification_status='QUALIFIED')::int AS qualified,
              count(*) FILTER (WHERE p.contact_email IS NOT NULL)::int AS verified_contacts
       FROM connect_prospects p
       WHERE p.client_id=ms.client_id AND p.market_id=ms.market_id AND p.segment_id=ms.segment_id
     ) prospect_counts ON true
     WHERE ms.client_id=$1`,
    [clientId]
  );
  return rows[0] ?? { market_segments: 0, active_market_segments: 0, planned_market_segments: 0, markets: 0, segments: 0, prospects: 0, qualified: 0, verified_contacts: 0 };
}
