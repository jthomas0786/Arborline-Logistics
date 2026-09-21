from pathlib import Path

path = Path("scripts/patch-deep-public-page-discovery.py")
text = path.read_text()
old = '''source = regex_once(
    source,
    r'function attachPublicProfileEmail\(.*?\n\}\n\nfunction extractSameDomainLinks\(.*?\n\}\n\nconst PUBLIC_PROFILE_HOSTS',
    new_attach,
    "strict profile attachment and ranked internal discovery",
)
'''
new = '''attach_replacement, discovery_replacement = new_attach.split("\\n\\nfunction peopleDiscoveryPriority", 1)
discovery_replacement = "function peopleDiscoveryPriority" + discovery_replacement
source = regex_once(
    source,
    r'function attachPublicProfileEmail\(.*?\n\}\n\nfunction extractSitemapLinks',
    attach_replacement + "\\n\\nfunction extractSitemapLinks",
    "strict profile attachment",
)
source = regex_once(
    source,
    r'function extractSameDomainLinks\(.*?\n\}\n\nconst PUBLIC_PROFILE_HOSTS',
    discovery_replacement,
    "ranked internal discovery",
)
'''
if text.count(old) != 1:
    raise SystemExit(f"expected one obsolete combined helper match, found {text.count(old)}")
path.write_text(text.replace(old, new, 1))
Path("scripts/patch-deep-public-page-discovery.error.txt").unlink(missing_ok=True)
print("fixed deep public discovery patcher function layout")
