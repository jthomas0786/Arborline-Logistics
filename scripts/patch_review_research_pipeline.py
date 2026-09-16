from pathlib import Path

research = Path("lib/connect-public-research.ts")
text = research.read_text()

old_particles = 'const NAME_PARTICLES = new Set(["al", "bin", "da", "de", "del", "della", "der", "di", "du", "la", "le", "van", "von"]);\n'
new_particles = old_particles + '''const US_STATE_CODES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC"
]);
'''
if "US_STATE_CODES" not in text:
    if old_particles not in text:
        raise SystemExit("name particle marker missing")
    text = text.replace(old_particles, new_particles, 1)

old_terms = '  "quote", "request", "schedule", "call", "free"\n]);'
new_terms = '  "quote", "request", "schedule", "call", "free", "downtown"\n]);'
if old_terms in text:
    text = text.replace(old_terms, new_terms, 1)

old_words = '''  const words = name.split(" ").filter(Boolean);
  if (words.length < 2 || words.length > 5) return false;
  if (words.some((word) => /\\d|https?|www\\./i.test(word))) return false;

  const normalizedWords = words.map((word) => word.toLowerCase().replace(/[^a-zà-öø-ÿ]/g, ""));
'''
new_words = '''  const words = name.split(" ").filter(Boolean);
  if (words.length < 2 || words.length > 5) return false;
  if (words.some((word) => /\\d|https?|www\\./i.test(word))) return false;
  // A raw two-letter uppercase state code beside a title is almost always
  // location/service-area text, not part of a person's name (e.g. Northglenn CO).
  if (words.some((word) => /^[A-Z]{2}$/.test(word) && US_STATE_CODES.has(word))) return false;

  const normalizedWords = words.map((word) => word.toLowerCase().replace(/[^a-zà-öø-ÿ]/g, ""));
  // Long adjacent strings without a real name particle are commonly nav/service-area
  // phrases. Keep precision high; 2-3 token names remain unaffected.
  if (words.length > 3 && !normalizedWords.some((word) => NAME_PARTICLES.has(word))) return false;
'''
if old_words not in text:
    raise SystemExit("person word marker missing")
text = text.replace(old_words, new_words, 1)
research.write_text(text)
