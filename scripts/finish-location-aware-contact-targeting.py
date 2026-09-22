from pathlib import Path

path = Path("lib/connect-prospect-scoring.ts")
text = path.read_text()

import_anchor = 'export type ConnectIcpProfile = {'
if import_anchor not in text:
    raise SystemExit("Scoring import anchor not found")
text = text.replace(
    import_anchor,
    'import { expandDecisionMakerTitles } from "@/lib/connect-contact-targeting";\n\n' + import_anchor,
    1,
)

old = '  add("contact", "Decision maker", 10, icp.decision_maker_titles.length > 0, matchesDecisionMakerTitle(icp.decision_maker_titles, prospect.contact_title), prospect.contact_title ? `Contact title: ${prospect.contact_title}.` : "Decision-maker title is missing.");'
new = '  const decisionMakerTitles = expandDecisionMakerTitles(icp.decision_maker_titles);\n  add("contact", "Decision maker", 10, decisionMakerTitles.length > 0, matchesDecisionMakerTitle(decisionMakerTitles, prospect.contact_title), prospect.contact_title ? `Contact title: ${prospect.contact_title}.` : "Decision-maker title is missing.");'
if old not in text:
    raise SystemExit("Decision-maker scoring anchor not found")
text = text.replace(old, new, 1)
path.write_text(text)
print("Qualification scoring now uses the same expanded operational title model as public research.")
