type ApolloOrganization = {
  id?: string;
  name?: string;
  website_url?: string;
  primary_domain?: string;
  industry?: string;
  estimated_num_employees?: number;
  city?: string;
  state?: string;
  country?: string;
  linkedin_url?: string;
};

type ApolloPerson = {
  id?: string;
  name?: string;
  title?: string;
  email?: string;
  city?: string;
  state?: string;
  country?: string;
  linkedin_url?: string;
};

export type ApolloCandidate = {
  company_name: string;
  website?: string;
  domain?: string;
  industry?: string;
  city?: string;
  state?: string;
  country?: string;
  employee_count?: number | null;
  location_count?: number | null;
  facility_type?: string;
  contact_name?: string;
  contact_title?: string;
  contact_email?: string;
  source: string;
  source_url?: string;
  buying_signals?: string[];
};

type ApolloIcp = {
  target_industries?: string[];
  target_geographies?: string[];
  min_employees?: number | null;
  max_employees?: number | null;
  facility_types?: string[];
  decision_maker_titles?: string[];
  buying_signals?: string[];
};

const API_ROOT = "https://api.apollo.io/api/v1";

function maxOrganizations() {
  const parsed = Number.parseInt(process.env.APOLLO_MAX_ORGS_PER_RUN || "20", 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 50) : 20;
}

async function apolloPost<T>(path: string, body: Record<string, unknown>) {
  const key = process.env.APOLLO_API_KEY?.trim();
  if (!key) throw new Error("Apollo API key is not configured.");
  const response = await fetch(`${API_ROOT}${path}`, {
    method: "POST",
    signal: AbortSignal.timeout(30000),
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "cache-control": "no-cache",
      "x-api-key": key
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Apollo ${path} returned ${response.status}${text ? `: ${text.slice(0, 180)}` : ""}`);
  }
  return response.json() as Promise<T>;
}

function employeeRanges(min?: number | null, max?: number | null) {
  if (min == null && max == null) return undefined;
  const low = Math.max(min ?? 1, 1);
  const high = Math.max(max ?? Math.max(low, 100000), low);
  return [`${low},${high}`];
}

function firstStrings(values?: string[], max = 10) {
  return Array.isArray(values) ? values.map(String).map(v => v.trim()).filter(Boolean).slice(0, max) : [];
}

async function findDecisionMaker(organizationId: string, titles: string[]) {
  const result = await apolloPost<{ people?: ApolloPerson[] }>("/mixed_people/api_search", {
    organization_ids: [organizationId],
    person_titles: titles.length ? titles : ["owner", "president", "operations manager", "office manager", "facility manager"],
    include_similar_titles: true,
    per_page: 3,
    page: 1
  });
  return result.people?.[0] ?? null;
}

async function enrichPerson(person: ApolloPerson, domain?: string) {
  const body: Record<string, unknown> = {
    reveal_personal_emails: false,
    reveal_phone_number: false
  };
  if (person.id) body.id = person.id;
  else if (person.name && domain) {
    body.name = person.name;
    body.domain = domain;
  } else return person;
  const result = await apolloPost<{ person?: ApolloPerson | null }>("/people/match", body);
  return result.person ?? person;
}

export function apolloConfigured() {
  return Boolean(process.env.APOLLO_API_KEY?.trim());
}

export async function sourceFromApollo(icp: ApolloIcp): Promise<ApolloCandidate[]> {
  const limit = maxOrganizations();
  const orgResult = await apolloPost<{ organizations?: ApolloOrganization[] }>("/mixed_companies/search", {
    q_organization_keyword_tags: firstStrings([...(icp.target_industries ?? []), ...(icp.facility_types ?? [])], 12),
    organization_locations: firstStrings(icp.target_geographies, 8),
    organization_num_employees_ranges: employeeRanges(icp.min_employees, icp.max_employees),
    page: 1,
    per_page: limit
  });

  const organizations = (orgResult.organizations ?? []).slice(0, limit);
  const candidates: ApolloCandidate[] = [];
  const titles = firstStrings(icp.decision_maker_titles, 12);

  for (const organization of organizations) {
    if (!organization.id || !organization.name) continue;
    let person: ApolloPerson | null = null;
    try {
      person = await findDecisionMaker(organization.id, titles);
      if (person) person = await enrichPerson(person, organization.primary_domain);
    } catch {
      person = null;
    }

    candidates.push({
      company_name: organization.name,
      website: organization.website_url,
      domain: organization.primary_domain,
      industry: organization.industry,
      city: organization.city,
      state: organization.state,
      country: organization.country || "US",
      employee_count: organization.estimated_num_employees ?? null,
      location_count: null,
      facility_type: icp.facility_types?.[0],
      contact_name: person?.name,
      contact_title: person?.title,
      contact_email: person?.email,
      source: "APOLLO",
      source_url: person?.linkedin_url || organization.linkedin_url || organization.website_url,
      buying_signals: firstStrings(icp.buying_signals, 10)
    });
  }

  return candidates;
}
