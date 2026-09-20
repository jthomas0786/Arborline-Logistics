from pathlib import Path


def replace_once(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text()
    if new in text:
        return
    if old not in text:
        raise SystemExit(f"anchor not found in {path}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1))


public = "lib/connect-public-research.ts"
replace_once(
    public,
    '''  binding: "STRUCTURED_PERSON" | "MAILTO_PERSON_ANCHOR" | "TEXT_NAME_EMAIL_PROXIMITY";\n  confidence: number;\n''',
    '''  binding: "STRUCTURED_PERSON" | "MAILTO_PERSON_ANCHOR" | "TEXT_NAME_EMAIL_PROXIMITY";\n  roleSignal?: boolean;\n  confidence: number;\n'''
)

replace_once(
    public,
    '''  return candidates.find(([, expected]) => expected === local)?.[0] ?? null;\n}\n\nfunction nearbyPersonNameForEmail(text: string, email: string, domain: string) {\n''',
    '''  return candidates.find(([, expected]) => expected === local)?.[0] ?? null;\n}\n\nconst PERSON_ROLE_SIGNAL = /\\b(?:president|owner|founder|co-founder|chief|ceo|cfo|coo|officer|vice president|vp|director|manager|partner|principal|executive|recruiter|coordinator|administrator|supervisor|sales|operations|business development|account executive|project manager|general manager)\\b/i;\n\nfunction hasPersonRoleSignal(value: string) {\n  return PERSON_ROLE_SIGNAL.test(value);\n}\n\nfunction nearbyPersonNameForEmail(text: string, email: string, domain: string) {\n'''
)

replace_once(
    public,
    '''        const tokenStart = tokens[start].index ?? before.length;\n        const distance = before.length - tokenStart;\n        if (distance > 700) continue;\n        if (!best || distance < best.distance) best = { name: candidate, pattern, distance };\n''',
    '''        const tokenStart = tokens[start].index ?? before.length;\n        const distance = before.length - tokenStart;\n        if (distance > 700) continue;\n        const roleContext = before.slice(Math.max(0, tokenStart - 160));\n        if (!hasPersonRoleSignal(roleContext)) continue;\n        if (!best || distance < best.distance) best = { name: candidate, pattern, distance };\n'''
)

replace_once(
    public,
    '''    const line = lines[index];\n    const emailIndex = line.toLowerCase().indexOf(normalizedEmail);\n    if (emailIndex < 0) continue;\n\n    const fragments: string[] = [];\n''',
    '''    const line = lines[index];\n    const emailIndex = line.toLowerCase().indexOf(normalizedEmail);\n    if (emailIndex < 0) continue;\n    const roleContext = lines\n      .slice(Math.max(0, index - 3), Math.min(lines.length, index + 2))\n      .join(" ");\n    if (!hasPersonRoleSignal(roleContext)) continue;\n\n    const fragments: string[] = [];\n'''
)

# There are exactly two text-proximity remember blocks; annotate both.
p = Path(public)
text = p.read_text()
needle = '''          binding: "TEXT_NAME_EMAIL_PROXIMITY",\n          confidence: 88\n'''
replacement = '''          binding: "TEXT_NAME_EMAIL_PROXIMITY",\n          roleSignal: true,\n          confidence: 88\n'''
if replacement not in text:
    if needle not in text:
        raise SystemExit("line-bound observation anchor not found")
    text = text.replace(needle, replacement, 1)
needle2 = '''        binding: "TEXT_NAME_EMAIL_PROXIMITY",\n        confidence: nearby.distance <= 260 ? 88 : 84\n'''
replacement2 = '''        binding: "TEXT_NAME_EMAIL_PROXIMITY",\n        roleSignal: true,\n        confidence: nearby.distance <= 260 ? 88 : 84\n'''
if replacement2 not in text:
    if needle2 not in text:
        raise SystemExit("nearby observation anchor not found")
    text = text.replace(needle2, replacement2, 1)
p.write_text(text)

native = "lib/connect-native-enrichment.ts"
replace_once(
    native,
    '''    const observation = asObject(item);\n    const pattern = String(observation.pattern ?? "") as EmailPattern;\n    if (!["FIRST.LAST","FIRST_LAST","FIRST-LAST","FIRSTLAST","F_LAST","F.LAST","FIRST"].includes(pattern)) continue;\n''',
    '''    const observation = asObject(item);\n    const binding = String(observation.binding ?? "");\n    if (!["STRUCTURED_PERSON","MAILTO_PERSON_ANCHOR","TEXT_NAME_EMAIL_PROXIMITY"].includes(binding)) continue;\n    if (binding === "TEXT_NAME_EMAIL_PROXIMITY" && observation.roleSignal !== true) continue;\n    const pattern = String(observation.pattern ?? "") as EmailPattern;\n    if (!["FIRST.LAST","FIRST_LAST","FIRST-LAST","FIRSTLAST","F_LAST","F.LAST","FIRST"].includes(pattern)) continue;\n'''
)

replace_once(
    native,
    '''        mailbox_verified: false,\n        version: 1\n''',
    '''        mailbox_verified: false,\n        role_signal_required_for_text_proximity: true,\n        version: 2\n'''
)
