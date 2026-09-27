import { researchPublicCompanySite } from "../../lib/connect-public-research";

const titles = [
  "Owner", "President", "CEO", "Founder", "General Manager", "Managing Partner",
  "COO", "Chief Operating Officer", "VP Sales", "Vice President of Sales",
  "Sales Director", "Sales Manager", "Director of Business Development",
  "Business Development Manager", "Director of Operations"
];

const cases = [
  {
    key: "ANDREWS",
    domain: "andrewsheating.com",
    segment: "hvac",
    industries: ["HVAC", "Heating & Air Conditioning", "Mechanical Services", "Commercial HVAC"],
    city: "Clinton",
    state: "Indiana",
    employeeCount: 10,
    locationCount: null
  },
  {
    key: "CINTAS",
    domain: "cintas.com",
    segment: "fire-protection",
    industries: ["Fire Protection Services", "Fire Sprinkler Services", "Fire Alarm Services", "Fire Extinguisher Services", "Life Safety Services"],
    city: "Lombard",
    state: "Illinois",
    employeeCount: null,
    locationCount: null
  },
  {
    key: "PRIORITY",
    domain: "prioritylandscape.net",
    segment: "landscaping",
    industries: ["Landscaping Services", "Commercial Landscaping", "Grounds Maintenance", "Landscape Maintenance", "Commercial Lawn Care"],
    city: "Gary",
    state: "Indiana",
    employeeCount: null,
    locationCount: null
  }
] as const;

async function main() {
  const output: Record<string, any> = {};

  for (const item of cases) {
    const result = await researchPublicCompanySite(item.domain, titles, item.segment, [...item.industries], {
      expanded: true,
      includePublicProfiles: true,
      targetCity: item.city,
      targetState: item.state,
      employeeCount: item.employeeCount,
      locationCount: item.locationCount,
      deadlineMs: 100000
    });

    output[item.key] = {
      status: result.status,
      candidate: result.candidate ? {
        name: result.candidate.name,
        title: result.candidate.title,
        decisionMakerConfidence: result.candidate.decisionMakerConfidence,
        targetingScore: result.candidate.targetingScore,
        targetingLocationMatch: result.candidate.targetingLocationMatch,
        sourceUrl: result.candidate.sourceUrl,
        publishedEmail: result.candidate.publishedEmail,
        inferredEmailCandidates: result.candidate.inferredEmailCandidates,
        evidence: result.candidate.evidence
      } : null,
      sharedInboxCandidates: result.sharedInboxCandidates,
      diagnostics: result.diagnostics,
      pagesChecked: result.pagesChecked,
      error: result.error ?? null
    };
  }

  console.log("ARBORLINE_CRAWLER_BENCHMARK_START");
  console.log(JSON.stringify(output, null, 2));
  console.log("ARBORLINE_CRAWLER_BENCHMARK_END");

  const andrews = output.ANDREWS;
  const cintas = output.CINTAS;
  const priority = output.PRIORITY;

  if (String(andrews?.candidate?.name ?? "").toLowerCase() !== "doug andrews") {
    throw new Error(`Andrews expected Doug Andrews; got ${andrews?.candidate?.name ?? "no candidate"}`);
  }
  if (!/^(president|ceo)$/i.test(String(andrews?.candidate?.title ?? ""))) {
    throw new Error(`Andrews expected President/CEO evidence; got ${andrews?.candidate?.title ?? "no title"}`);
  }
  if (andrews?.candidate?.publishedEmail) {
    throw new Error("Andrews must not invent or promote a Doug email.");
  }

  if (String(cintas?.candidate?.name ?? "").toLowerCase() === "catie bancroft") {
    throw new Error("Cintas regression: Catie Bancroft false positive returned.");
  }
  if (cintas?.candidate && String(cintas.candidate.name).toLowerCase() !== "james n. rozakis") {
    throw new Error(`Cintas expected James N. Rozakis when a candidate is available; got ${cintas.candidate.name}`);
  }
  if (cintas?.candidate?.publishedEmail) {
    throw new Error("Cintas benchmark must not promote an unbound person email.");
  }

  if (String(priority?.candidate?.name ?? "").toLowerCase() !== "neftali robles") {
    throw new Error(`Priority expected Neftali Robles; got ${priority?.candidate?.name ?? "no candidate"}`);
  }
  if (String(priority?.candidate?.name ?? "").toLowerCase() === "west michigan") {
    throw new Error("Priority regression: West Michigan was treated as a person.");
  }
  if (Number(priority?.candidate?.decisionMakerConfidence ?? 0) < 85) {
    throw new Error(`Priority confidence below 85: ${priority?.candidate?.decisionMakerConfidence ?? 0}`);
  }
  if (Number(priority?.candidate?.targetingScore ?? 0) < 100) {
    throw new Error(`Priority targeting score below 100: ${priority?.candidate?.targetingScore ?? 0}`);
  }
  if (priority?.candidate?.targetingLocationMatch !== "TARGET_CITY") {
    throw new Error(`Priority location match regressed: ${priority?.candidate?.targetingLocationMatch ?? "none"}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
