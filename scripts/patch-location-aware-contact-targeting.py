from pathlib import Path


def replace(path, old, new, count=1):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"Expected patch anchor missing in {path}: {old[:120]!r}")
    p.write_text(text.replace(old, new, count))


path = "lib/connect-public-research.ts"

replace(path,
'import { evaluateConnectServiceFit, type ConnectServiceFitResult } from "@/lib/connect-service-fit";\n',
'import { evaluateConnectServiceFit, type ConnectServiceFitResult } from "@/lib/connect-service-fit";\nimport {\n  expandDecisionMakerTitles,\n  rankSharedInboxes,\n  scoreContactTarget,\n  type ContactCompanySize,\n  type ContactLocationMatch,\n  type ContactRoleFunction,\n  type ContactSeniority,\n  type ContactTargetingContext,\n  type SharedInboxCandidate\n} from "@/lib/connect-contact-targeting";\n')

replace(path,
'  sourceUrl: string | null;\n  evidence: string[];\n};\n\nexport type PublicResearchOptions = { expanded?: boolean; includePublicProfiles?: boolean; deadlineMs?: number };',
'  sourceUrl: string | null;\n  targetingScore: number;\n  targetingCompanySize: ContactCompanySize;\n  targetingRoleFunction: ContactRoleFunction;\n  targetingSeniority: ContactSeniority;\n  targetingLocationMatch: ContactLocationMatch;\n  targetingReasons: string[];\n  evidence: string[];\n};\n\nexport type PublicResearchOptions = ContactTargetingContext & { expanded?: boolean; includePublicProfiles?: boolean; deadlineMs?: number };')

replace(path,
'  emailPatternObservations: PublicEmailPatternObservation[];\n  diagnostics?: PublicResearchDiagnostics;',
'  emailPatternObservations: PublicEmailPatternObservation[];\n  sharedInboxCandidates?: SharedInboxCandidate[];\n  diagnostics?: PublicResearchDiagnostics;')

old_storage = '''function publishedCompanyEmailsForStorage(
  pages: PageSnapshot[],
  domain: string,
  observations: PublicEmailPatternObservation[]
) {
  const strictEmails = new Set(observations.map((item) => item.email.toLowerCase()));
  const all = [...new Set(pages.flatMap((page) => extractEmails(page.html, domain)))];
  return all.filter((email) => {
    if (strictEmails.has(email.toLowerCase())) return true;
    const local = email.split("@")[0]?.toLowerCase() ?? "";
    return GENERIC_EMAIL_LOCAL_PARTS.has(local);
  });
}'''
new_storage = '''function publishedCompanyEmailsForStorage(
  pages: PageSnapshot[],
  domain: string,
  observations: PublicEmailPatternObservation[],
  targetingContext: ContactTargetingContext = {}
) {
  const strictEmails = new Set(observations.map((item) => item.email.toLowerCase()));
  const all = [...new Set(pages.flatMap((page) => extractEmails(page.html, domain)))];
  return all.filter((email) => {
    if (strictEmails.has(email.toLowerCase())) return true;
    return rankSharedInboxes([email], targetingContext).length > 0;
  });
}'''
replace(path, old_storage, new_storage)

replace(path,
'function candidateFromStructuredData(pages: PageSnapshot[], domain: string, approvedTitles: string[]): PublicResearchCandidate | null {',
'function candidateFromStructuredData(pages: PageSnapshot[], domain: string, approvedTitles: string[], targetingContext: ContactTargetingContext = {}): PublicResearchCandidate | null {')

replace(path,
'      decisionMakerConfidence = Math.min(99, decisionMakerConfidence);\n\n      const candidate: PublicResearchCandidate = {',
'      decisionMakerConfidence = Math.min(99, decisionMakerConfidence);\n      const targeting = scoreContactTarget(matchedTitle, JSON.stringify(obj), page.url, targetingContext);\n\n      const candidate: PublicResearchCandidate = {')

replace(path,
'        inferredEmailCandidates: publishedEmail ? [] : inferredEmails(name, domain),\n        sourceUrl: page.url,\n        evidence: [',
'        inferredEmailCandidates: publishedEmail ? [] : inferredEmails(name, domain),\n        sourceUrl: page.url,\n        targetingScore: targeting.score,\n        targetingCompanySize: targeting.companySize,\n        targetingRoleFunction: targeting.roleFunction,\n        targetingSeniority: targeting.seniority,\n        targetingLocationMatch: targeting.locationMatch,\n        targetingReasons: targeting.reasons,\n        evidence: [', 1)

replace(path,
'      const strength = candidate.decisionMakerConfidence + candidate.emailConfidence;\n      const bestStrength = best ? best.decisionMakerConfidence + best.emailConfidence : -1;',
'      const strength = candidate.decisionMakerConfidence + candidate.targetingScore + (candidate.publishedEmail ? 12 : 0);\n      const bestStrength = best ? best.decisionMakerConfidence + best.targetingScore + (best.publishedEmail ? 12 : 0) : -1;')

replace(path,
'function candidateFromPages(pages: PageSnapshot[], domain: string, approvedTitles: string[], emailPatternObservations: PublicEmailPatternObservation[] = []): PublicResearchCandidate | null {',
'function candidateFromPages(pages: PageSnapshot[], domain: string, approvedTitles: string[], emailPatternObservations: PublicEmailPatternObservation[] = [], targetingContext: ContactTargetingContext = {}): PublicResearchCandidate | null {')

replace(path,
'      ];\n\n      const candidate: PublicResearchCandidate = {\n        name,\n        title: matchedTitle,',
'      ];\n      const contextText = lines.slice(Math.max(0, index - 3), Math.min(lines.length, index + 4)).join("\\n");\n      const targeting = scoreContactTarget(matchedTitle, contextText, page.url, targetingContext);\n\n      const candidate: PublicResearchCandidate = {\n        name,\n        title: matchedTitle,')

replace(path,
'        inferredEmailCandidates: publishedEmail ? [] : inferredEmails(name, domain),\n        sourceUrl: page.url,\n        evidence\n      };',
'        inferredEmailCandidates: publishedEmail ? [] : inferredEmails(name, domain),\n        sourceUrl: page.url,\n        targetingScore: targeting.score,\n        targetingCompanySize: targeting.companySize,\n        targetingRoleFunction: targeting.roleFunction,\n        targetingSeniority: targeting.seniority,\n        targetingLocationMatch: targeting.locationMatch,\n        targetingReasons: targeting.reasons,\n        evidence\n      };')

replace(path,
'      const candidateStrength = candidate.decisionMakerConfidence + candidate.emailConfidence;\n      const bestStrength = best ? best.decisionMakerConfidence + best.emailConfidence : -1;',
'      const candidateStrength = candidate.decisionMakerConfidence + candidate.targetingScore + (candidate.publishedEmail ? 12 : 0);\n      const bestStrength = best ? best.decisionMakerConfidence + best.targetingScore + (best.publishedEmail ? 12 : 0) : -1;')

replace(path,
'  const deadlineReached = () => deadlineAt !== null && Date.now() >= deadlineAt;\n\n  try {',
'  const deadlineReached = () => deadlineAt !== null && Date.now() >= deadlineAt;\n  const targetingContext: ContactTargetingContext = {\n    targetCity: options.targetCity ?? null,\n    targetState: options.targetState ?? null,\n    employeeCount: options.employeeCount ?? null,\n    locationCount: options.locationCount ?? null\n  };\n  const targetTitles = expandDecisionMakerTitles(approvedTitles);\n\n  try {')

replace(path,
'    const publishedEmails = publishedCompanyEmailsForStorage(allEvidencePages, domain, emailPatternObservations);\n    const textCandidate = candidateFromPages(allEvidencePages, domain, approvedTitles, emailPatternObservations);\n    const structuredCandidate = candidateFromStructuredData(allEvidencePages, domain, approvedTitles);\n    const baseCandidate = [structuredCandidate, textCandidate]\n      .filter((item): item is PublicResearchCandidate => Boolean(item))\n      .sort((a, b) => (b.decisionMakerConfidence + b.emailConfidence) - (a.decisionMakerConfidence + a.emailConfidence))[0] ?? null;',
'    const publishedEmails = publishedCompanyEmailsForStorage(allEvidencePages, domain, emailPatternObservations, targetingContext);\n    const sharedInboxCandidates = rankSharedInboxes(publishedEmails, targetingContext);\n    const textCandidate = candidateFromPages(allEvidencePages, domain, targetTitles, emailPatternObservations, targetingContext);\n    const structuredCandidate = candidateFromStructuredData(allEvidencePages, domain, targetTitles, targetingContext);\n    const baseCandidate = [structuredCandidate, textCandidate]\n      .filter((item): item is PublicResearchCandidate => Boolean(item))\n      .sort((a, b) => (b.decisionMakerConfidence + b.targetingScore + (b.publishedEmail ? 12 : 0)) - (a.decisionMakerConfidence + a.targetingScore + (a.publishedEmail ? 12 : 0)))[0] ?? null;')

replace(path,
'      publishedEmails,\n      emailPatternObservations,\n      diagnostics,',
'      publishedEmails,\n      emailPatternObservations,\n      sharedInboxCandidates,\n      diagnostics,')

replace(path,
'    `SELECT id,domain,company_name,contact_name,contact_title,source\n     FROM connect_prospects',
'    `SELECT id,domain,company_name,contact_name,contact_title,source,city,state,employee_count,location_count\n     FROM connect_prospects')

replace(path,
'      segmentId && Array.isArray(profile.rows[0]?.target_industries) ? profile.rows[0].target_industries.map(String) : []\n    );',
'      segmentId && Array.isArray(profile.rows[0]?.target_industries) ? profile.rows[0].target_industries.map(String) : [],\n      {\n        targetCity: row.city ?? null,\n        targetState: row.state ?? null,\n        employeeCount: row.employee_count ?? null,\n        locationCount: row.location_count ?? null\n      }\n    );')

replace(path,
'        decision_maker_proximity: candidate?.proximity ?? null,\n        published_email: candidate?.publishedEmail ?? null,',
'        decision_maker_proximity: candidate?.proximity ?? null,\n        targeting_model_version: "LOCATION_FUNCTION_V1",\n        targeting_score: candidate?.targetingScore ?? 0,\n        targeting_company_size: candidate?.targetingCompanySize ?? null,\n        targeting_role_function: candidate?.targetingRoleFunction ?? null,\n        targeting_seniority: candidate?.targetingSeniority ?? null,\n        targeting_location_match: candidate?.targetingLocationMatch ?? null,\n        targeting_reasons: candidate?.targetingReasons ?? [],\n        shared_inbox_candidates: result.sharedInboxCandidates ?? [],\n        published_email: candidate?.publishedEmail ?? null,', 1)

path = "lib/connect-national-worker-fleet.ts"
replace(path,
'      { expanded: benchmarkMode || Boolean(row.is_qualification_acceleration), includePublicProfiles: benchmarkMode || Boolean(row.is_qualification_acceleration) }\n    );',
'      {\n        expanded: benchmarkMode || Boolean(row.is_qualification_acceleration),\n        includePublicProfiles: benchmarkMode || Boolean(row.is_qualification_acceleration),\n        targetCity: row.city ?? null,\n        targetState: row.state ?? null,\n        employeeCount: row.employee_count ?? null,\n        locationCount: row.location_count ?? null\n      }\n    );')

replace(path,
'        decision_maker_source_kind: candidate?.sourceKind ?? null,\n        published_email: candidate?.publishedEmail ?? null,',
'        decision_maker_source_kind: candidate?.sourceKind ?? null,\n        targeting_model_version: "LOCATION_FUNCTION_V1",\n        targeting_score: candidate?.targetingScore ?? 0,\n        targeting_company_size: candidate?.targetingCompanySize ?? null,\n        targeting_role_function: candidate?.targetingRoleFunction ?? null,\n        targeting_seniority: candidate?.targetingSeniority ?? null,\n        targeting_location_match: candidate?.targetingLocationMatch ?? null,\n        targeting_reasons: candidate?.targetingReasons ?? [],\n        shared_inbox_candidates: result.sharedInboxCandidates ?? [],\n        published_email: candidate?.publishedEmail ?? null,')

path = "lib/connect-outreach-drafts.ts"
replace(path,
    r'If they’re useful, I can show you how we keep finding more each week.\n\nIf it’s not relevant, just say so and I’ll stop.',
    r'If they’re useful, I can show you how we keep finding more each week.\n\nIf this falls under someone else on your team, feel free to point me their way or loop them in.\n\nIf it’s not relevant, just say so and I’ll stop.')

print("Location-aware contact targeting patch applied.")
