from pathlib import Path

path = Path("lib/connect-contact-targeting.ts")
text = path.read_text()

replacements = [
    (
        '  const stateKeys = [compact(stateName), compact(stateCode)].filter((value) => value.length > 2 || (value.length === 2 && !["in", "or", "me"].includes(value)));',
        '  const stateNameKey = compact(stateName);\n  const stateCodeKey = compact(stateCode);'
    ),
    (
        '    const localKey = compact(local);\n    let classification = sharedFunction(local);',
        '    const localKey = compact(local);\n    if (BLOCKED_SHARED_LOCAL_PARTS.has(localKey)) continue;\n    const localTokens = normalize(local).split(" ").filter(Boolean);\n    let classification = sharedFunction(local);'
    ),
    (
        '    } else if (stateKeys.some((stateKey) => stateKey && localKey.includes(stateKey))) {',
        '    } else if ((stateNameKey && localKey.includes(stateNameKey)) || (stateCodeKey && localTokens.includes(stateCodeKey))) {'
    )
]

for old, new in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected exactly one patch anchor, found {count}: {old[:90]}")
    text = text.replace(old, new, 1)

path.write_text(text)
print("Patched shared inbox geography matching safely.")
