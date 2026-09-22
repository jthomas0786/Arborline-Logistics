from pathlib import Path

path = Path("scripts/patch-location-aware-contact-targeting.py")
text = path.read_text()
marker = '\npath = "lib/connect-outreach-drafts.ts"\n'
if marker not in text:
    raise SystemExit("Outreach patch marker not found")
head = text.split(marker, 1)[0]
tail = r'''
path = "lib/connect-outreach-drafts.ts"
replace(path,
    r'If they’re useful, I can show you how we keep finding more each week.\n\nIf it’s not relevant, just say so and I’ll stop.',
    r'If they’re useful, I can show you how we keep finding more each week.\n\nIf this falls under someone else on your team, feel free to point me their way or loop them in.\n\nIf it’s not relevant, just say so and I’ll stop.')

print("Location-aware contact targeting patch applied.")
'''
path.write_text(head + tail)
print("Repaired outreach draft anchor in targeting patcher.")
