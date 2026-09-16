from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"missing marker: {label}")
    return text.replace(old, new, 1)


# Provider enrichment must not spend credits or populate an outreach recipient
# for a self-discovered company until its own website verifies the service fit.
enrichment_path = Path("lib/connect-contact-enrichment.ts")
text = enrichment_path.read_text()
text = replace_once(
    text,
    "      AND qualification_status='QUALIFIED' AND enrichment_status='PARTIAL' AND contact_email IS NULL AND domain IS NOT NULL",
    "      AND qualification_status='QUALIFIED'\n      AND (source <> 'ARBORLINE_DISCOVERY' OR source_metadata->'service_fit'->>'status'='MATCH')\n      AND enrichment_status='PARTIAL' AND contact_email IS NULL AND domain IS NOT NULL",
    "contact enrichment service-fit gate",
)
enrichment_path.write_text(text)


# Draft generation gets the same defense-in-depth gate. Even if a future bug
# accidentally marks a self-discovered row READY, it cannot become a draft.
drafts_path = Path("lib/connect-outreach-drafts.ts")
text = drafts_path.read_text()
text = replace_once(
    text,
    "AND p.qualification_status='QUALIFIED' AND p.outreach_status='READY'",
    "AND p.qualification_status='QUALIFIED' AND (p.source <> 'ARBORLINE_DISCOVERY' OR p.source_metadata->'service_fit'->>'status'='MATCH') AND p.outreach_status='READY'",
    "draft service-fit gate",
)
drafts_path.write_text(text)


# Final send claim and preview must independently enforce the same rule so a
# stale/incorrect queued status can never bypass website service verification.
send_path = Path("lib/connect-outreach-send.ts")
text = send_path.read_text()
old = "         AND p.qualification_status='QUALIFIED'\n         AND p.outreach_status='QUEUED'"
new = "         AND p.qualification_status='QUALIFIED'\n         AND (p.source <> 'ARBORLINE_DISCOVERY' OR p.source_metadata->'service_fit'->>'status'='MATCH')\n         AND p.outreach_status='QUEUED'"
if text.count(old) != 2:
    raise SystemExit(f"expected two queued-send qualification markers, found {text.count(old)}")
text = text.replace(old, new)
send_path.write_text(text)
