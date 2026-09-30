from pathlib import Path

path = Path('lib/connect-outreach-recipient.ts')
text = path.read_text()
old = 'export function selectCanonicalOutreachRecipient(prospect: CandidateRecord) {'
new = 'export function selectCanonicalOutreachRecipient<T extends CandidateRecord>(prospect: T) {'
if old not in text:
    raise SystemExit('canonical selector signature anchor missing')
path.write_text(text.replace(old, new, 1))
print('canonical recipient generic typing applied')
