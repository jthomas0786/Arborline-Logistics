import { researchPublicCompanySite } from "../lib/connect-public-research";

const domains = [
  "femoran.com",
  "kodiakls.com",
  "elliottlewis.com",
  "anchor-roofs.com",
  "smithdfw.com",
  "rapidpestsolutions.com",
  "urbanfire.com",
  "eadsroofing.com",
  "premierpestsolutionswi.com",
  "performancep.com",
  "brilliantfs.com",
  "jaycrew.com",
  "landmarklandscapes.pro",
  "actionheatinginc.com",
  "precisionhvacinc.com"
];

const titles = [
  "Owner", "Founder", "Co-Founder", "President", "Chief Executive Officer", "CEO",
  "Managing Partner", "Principal", "Chief Operating Officer", "COO", "General Manager",
  "Managing Director", "Vice President", "Director of Operations", "Director", "Manager"
];

for (const domain of domains) {
  try {
    const result = await researchPublicCompanySite(domain, titles, "", [], {
      expanded: true,
      includePublicProfiles: false,
      deadlineMs: 40_000
    });
    console.log("ARBORLINE_PERSON_EMAIL_PROBE " + JSON.stringify({
      domain,
      status: result.status,
      observations: result.emailPatternObservations,
      publishedEmails: result.publishedEmails,
      pagesChecked: result.pagesChecked
    }));
  } catch (error) {
    console.log("ARBORLINE_PERSON_EMAIL_PROBE " + JSON.stringify({
      domain,
      status: "ERROR",
      error: error instanceof Error ? error.message : String(error)
    }));
  }
}
