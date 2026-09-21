from pathlib import Path

public_path = Path("lib/connect-public-research.ts")
text = public_path.read_text()

old = '''function publicEmployeeEmailObservations(pages: PageSnapshot[], domain: string) {
  const observations = new Map<string, PublicEmailPatternObservation>();
  const remember = (observation: PublicEmailPatternObservation) => {
    const key = `${observation.name.toLowerCase()}|${observation.email.toLowerCase()}`;'''
new = '''function publicEmployeeEmailObservations(pages: PageSnapshot[], domain: string) {
  const observations = new Map<string, PublicEmailPatternObservation>();
  const strictBindings = new Set<PublicEmailPatternObservation["binding"]>([
    "STRUCTURED_PERSON",
    "MAILTO_PERSON_ANCHOR"
  ]);
  const remember = (observation: PublicEmailPatternObservation) => {
    // Only exact public bindings may teach a company email pattern. Free-text
    // proximity remains research evidence only and can never enter this lane.
    if (!strictBindings.has(observation.binding)) return;
    const key = `${observation.name.toLowerCase()}|${observation.email.toLowerCase()}`;'''
if text.count(old) != 1:
    raise SystemExit(f"public strict binding insertion match count={text.count(old)}")
text = text.replace(old, new, 1)
public_path.write_text(text)

native_path = Path("lib/connect-native-enrichment.ts")
text = native_path.read_text()

old = '''    if (!["STRUCTURED_PERSON","MAILTO_PERSON_ANCHOR","TEXT_NAME_EMAIL_PROXIMITY"].includes(binding)) continue;
    if (binding === "TEXT_NAME_EMAIL_PROXIMITY" && observation.roleSignal !== true) continue;'''
new = '''    if (!["STRUCTURED_PERSON","MAILTO_PERSON_ANCHOR"].includes(binding)) continue;'''
if text.count(old) != 1:
    raise SystemExit(f"native binding allowlist match count={text.count(old)}")
text = text.replace(old, new, 1)

old = '''        mailbox_verified: false,
        role_signal_required_for_text_proximity: true,
        version: 2'''
new = '''        mailbox_verified: false,
        strict_public_bindings_only: true,
        version: 3'''
if text.count(old) != 1:
    raise SystemExit(f"native metadata marker match count={text.count(old)}")
text = text.replace(old, new, 1)
native_path.write_text(text)
