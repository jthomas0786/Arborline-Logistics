from pathlib import Path

research = Path("lib/connect-public-research.ts")
text = research.read_text()

old_terms = '  "quote", "request", "schedule", "call", "free", "downtown"\n]);'
new_terms = '  "quote", "request", "schedule", "call", "free", "downtown", "view", "all", "projects", "learn", "more"\n]);'
if old_terms in text:
    text = text.replace(old_terms, new_terms, 1)

old_confidence = '      let decisionMakerConfidence = proximity === "SAME_LINE" ? 82 : 76;'
new_confidence = '''      // Adjacent text is much noisier than a same-line name/title pair. It can
      // still become HIGH confidence when a person-matching published email
      // corroborates it, but page placement + repetition alone is not enough.
      let decisionMakerConfidence = proximity === "SAME_LINE" ? 82 : 68;'''
if old_confidence not in text:
    raise SystemExit("decision-maker confidence marker missing")
text = text.replace(old_confidence, new_confidence, 1)
research.write_text(text)
