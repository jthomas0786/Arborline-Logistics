from pathlib import Path
import runpy

worker = Path("lib/connect-national-worker-fleet.ts")
s = worker.read_text()

timeout_old = '''        candidate: null,
        publishedEmails: [],
        pagesChecked: [],
        robotsRespected: true,
'''
timeout_new = '''        candidate: null,
        publishedEmails: [],
        emailPatternObservations: [],
        pagesChecked: [],
        robotsRespected: true,
'''
if timeout_old not in s:
    raise SystemExit("national timeout fallback anchor not found")
s = s.replace(timeout_old, timeout_new, 1)

current_old = '''        published_company_emails: result.publishedEmails.slice(0, 12),
        source_url: candidate?.sourceUrl ?? null,
'''
compat = '''    published_company_emails: result.publishedEmails.slice(0, 20),
    source_url: candidate.sourceUrl,
'''
if current_old not in s:
    raise SystemExit("current national public-research metadata anchor not found")
s = s.replace(current_old, compat, 1)
worker.write_text(s)

# Reuse the reviewed patch for public research + native enrichment.
runpy.run_path(".github/scripts/patch_public_person_email.py", run_name="__main__")

# Restore the current worker's safer optional candidate semantics and 12-item cap,
# while preserving the newly added person-email observations.
s = worker.read_text()
generated = '''    published_company_emails: result.publishedEmails.slice(0, 20),
    public_email_pattern_observations: result.emailPatternObservations.slice(0, 20),
    source_url: candidate.sourceUrl,
'''
final = '''        published_company_emails: result.publishedEmails.slice(0, 12),
        public_email_pattern_observations: result.emailPatternObservations.slice(0, 20),
        source_url: candidate?.sourceUrl ?? null,
'''
if generated not in s:
    raise SystemExit("generated national metadata block not found")
s = s.replace(generated, final, 1)
worker.write_text(s)
