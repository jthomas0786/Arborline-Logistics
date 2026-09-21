from pathlib import Path

path = Path("scripts/patch-deep-public-page-discovery.py")
text = path.read_text()
start_marker = '''source = regex_once(
    source,
    r'function attachPublicProfileEmail'''
end_marker = "\nnew_sitemap = r'''"
start = text.find(start_marker)
end = text.find(end_marker, start if start >= 0 else 0)
if start < 0 or end < 0 or end <= start:
    raise SystemExit(f"could not locate combined helper replacement block: start={start} end={end}")
replacement = '''attach_replacement, discovery_replacement = new_attach.split("\\n\\nfunction peopleDiscoveryPriority", 1)
discovery_replacement = "function peopleDiscoveryPriority" + discovery_replacement
source = regex_once(
    source,
    r'function attachPublicProfileEmail\\(.*?\\n\\}\\n\\nfunction extractSitemapLinks',
    attach_replacement + "\\n\\nfunction extractSitemapLinks",
    "strict profile attachment",
)
source = regex_once(
    source,
    r'function extractSameDomainLinks\\(.*?\\n\\}\\n\\nconst PUBLIC_PROFILE_HOSTS',
    discovery_replacement,
    "ranked internal discovery",
)
'''
path.write_text(text[:start] + replacement + text[end:])
Path("scripts/patch-deep-public-page-discovery.error.txt").unlink(missing_ok=True)
print("fixed deep public discovery patcher function layout")
