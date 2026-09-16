#!/usr/bin/env python3
"""Download Overture Places regions, keep high-signal ALC service companies, and ingest safely."""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import tempfile
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

API_URL = "https://www.arborlineconnect.com/api/cron/connect-overture-discovery"
MIN_CONFIDENCE = 0.55
MAX_PER_SEGMENT = 30


@dataclass(frozen=True)
class Region:
    state: str
    geography: str
    name: str
    west: float
    south: float
    east: float
    north: float


REGIONS = {
    "Illinois": [
        # Keep the east edge west of the Illinois/Indiana boundary. Address-state
        # validation below is the authoritative border guard for all regions.
        Region("IL", "Illinois", "chicago-core", -88.15, 41.55, -87.52, 42.10),
        Region("IL", "Illinois", "chicago-suburbs", -88.65, 41.25, -87.65, 42.25),
        Region("IL", "Illinois", "rockford", -89.55, 41.90, -88.65, 42.65),
        Region("IL", "Illinois", "quad-cities", -91.15, 40.95, -89.85, 41.85),
        Region("IL", "Illinois", "peoria-bloomington", -90.15, 40.20, -88.55, 41.10),
        Region("IL", "Illinois", "springfield-decatur", -90.10, 39.35, -88.45, 40.20),
        Region("IL", "Illinois", "champaign-kankakee", -88.55, 39.70, -87.45, 41.35),
        Region("IL", "Illinois", "metro-east-southern", -90.85, 37.10, -88.10, 39.20),
    ],
    "Indiana": [
        Region("IN", "Indiana", "indianapolis", -86.55, 39.45, -85.75, 40.15),
        Region("IN", "Indiana", "northwest-indiana", -87.65, 41.05, -86.65, 41.85),
        Region("IN", "Indiana", "fort-wayne", -85.65, 40.75, -84.75, 41.35),
        Region("IN", "Indiana", "south-bend-elkhart", -86.75, 41.25, -85.55, 41.90),
        Region("IN", "Indiana", "lafayette-kokomo", -87.10, 40.15, -85.75, 40.85),
        Region("IN", "Indiana", "terre-haute-bloomington", -87.65, 38.85, -86.20, 39.65),
        Region("IN", "Indiana", "evansville", -88.10, 37.65, -86.85, 38.40),
        Region("IN", "Indiana", "southeast-indiana", -86.50, 38.25, -84.70, 39.35),
    ],
    "Wisconsin": [
        Region("WI", "Wisconsin", "milwaukee", -88.45, 42.75, -87.75, 43.45),
        Region("WI", "Wisconsin", "madison", -89.85, 42.75, -88.75, 43.45),
        Region("WI", "Wisconsin", "kenosha-racine", -88.45, 42.45, -87.75, 42.95),
        Region("WI", "Wisconsin", "green-bay-appleton", -89.00, 43.85, -87.55, 44.75),
        Region("WI", "Wisconsin", "eau-claire", -92.20, 44.45, -90.75, 45.20),
        Region("WI", "Wisconsin", "la-crosse", -91.65, 43.45, -90.35, 44.25),
        Region("WI", "Wisconsin", "wausau-stevens-point", -90.35, 44.20, -88.85, 45.25),
        Region("WI", "Wisconsin", "north-wisconsin", -92.25, 45.10, -87.00, 46.85),
    ],
}

STATE_ALIASES = {
    "IL": {"IL", "ILLINOIS", "US-IL", "US_IL"},
    "IN": {"IN", "INDIANA", "US-IN", "US_IN"},
    "WI": {"WI", "WISCONSIN", "US-WI", "US_WI"},
}

SEGMENT_PATTERNS = {
    "commercial-cleaning": [r"\bjanitorial\b", r"\bcommercial cleaning\b", r"\bcleaning service\b", r"\bcleaner\b"],
    "hvac": [r"\bhvac\b", r"\bheating and (?:air|cooling)\b", r"\bair conditioning\b", r"\bheating contractor\b"],
    "staffing": [r"\bstaffing\b", r"\bemployment agenc", r"\brecruit(?:er|ing|ment)\b", r"\btemp agency\b"],
    "landscaping": [r"\blandscap", r"\blawn care\b", r"\bgrounds maintenance\b"],
    "commercial-roofing": [r"\broof(?:er|ers|ing)?\b", r"\broof contractor\b"],
    "pest-control": [r"\bpest control\b", r"\bpest management\b", r"\bexterminat", r"\btermite\b", r"\bmosquito\b", r"\bwildlife removal\b"],
    "fire-protection": [r"\bfire protection\b", r"\bfire sprinkler\b", r"\bfire alarm\b", r"\blife safety\b", r"\bfire extinguisher\b"],
    "commercial-plumbing": [r"\bplumb(?:er|ers|ing)?\b", r"\brooter\b", r"\bdrain\b", r"\bsewer\b"],
}

SEGMENT_EXCLUSIONS = {
    "commercial-cleaning": [r"\bdry clean", r"\bcar wash\b", r"\blaund"],
    "hvac": [r"\bappliance store\b"],
    "staffing": [r"\bschool\b", r"\bgovernment\b"],
    "landscaping": [r"\bgarden center\b", r"\bnursery\b"],
    "commercial-roofing": [r"\broofing supply\b", r"\bbuilding supply\b", r"\bacademy\b", r"\bschool\b", r"\btraining center\b", r"roofing school", r"\blocal\s+\d+\b"],
    "pest-control": [r"\bpest control supply\b", r"\bpest management supply\b", r"\babatement district\b"],
    "fire-protection": [r"\bfire department\b", r"\bfire station\b", r"\bfire protection district\b", r"\bfire district\b", r"\bacademy\b", r"\btraining\b", r"\bfirearm\b", r"\bgun\b"],
    "commercial-plumbing": [r"\bplumbing supply\b", r"\bpipe (?:and|&) supply\b", r"\bsupply co\b", r"\bfixtures?\b", r"\bfaucets?\b", r"\bkitchen showroom\b"],
}

COMMON_NON_SERVICE_TAXONOMY = {
    "hotel", "lodging", "motel", "bar", "cocktail_bar", "alcoholic_beverage_venue", "lounge",
    "event_or_party_service", "party_and_event_planning", "farm", "urban_farm", "labor_union",
    "specialty_school", "vocational_and_technical_school", "place_of_learning", "police_station",
    "police_department", "public_safety_service", "public_service_and_government", "central_government_office",
    "gun_and_ammo_store", "gun_and_ammo", "food_and_beverage_store", "honey_farm_shop",
}

SUPPLY_MANUFACTURING_TAXONOMY = {
    "warehouse_club_store", "wholesale_store", "manufacturer", "industrial_equipment_manufacturer",
    "appliance_manufacturer", "building_supply_store", "hardware_home_and_garden_store", "metal_fabricator",
}

SERVICE_CONTEXT = {
    "home_service", "professional_service", "professional_services", "contractor", "construction_services",
    "building_or_construction_service", "b2b_service", "b2b_office_and_professional_service",
    "business_to_business", "business_to_business_services",
}


def string_values(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value]
    if isinstance(value, (int, float, bool)):
        return [str(value)]
    if isinstance(value, list):
        out: list[str] = []
        for item in value:
            out.extend(string_values(item))
        return out
    if isinstance(value, dict):
        out: list[str] = []
        for item in value.values():
            out.extend(string_values(item))
        return out
    return []


def primary_name(properties: dict[str, Any]) -> str:
    names = properties.get("names") or {}
    if isinstance(names, dict):
        value = names.get("primary")
        if isinstance(value, str):
            return value.strip()
        if isinstance(value, dict):
            for key in ("name", "value"):
                candidate = value.get(key)
                if isinstance(candidate, str) and candidate.strip():
                    return candidate.strip()
    brand = properties.get("brand") or {}
    if isinstance(brand, dict):
        bnames = brand.get("names") or {}
        if isinstance(bnames, dict) and isinstance(bnames.get("primary"), str):
            return bnames["primary"].strip()
    return ""


def first_website(properties: dict[str, Any]) -> str:
    websites = properties.get("websites")
    for value in string_values(websites):
        value = value.strip()
        if value.startswith(("http://", "https://")):
            return value
    return ""


def first_address(properties: dict[str, Any]) -> dict[str, Any] | None:
    addresses = properties.get("addresses")
    if isinstance(addresses, list):
        for address in addresses:
            if isinstance(address, dict):
                return address
    return None


def locality(properties: dict[str, Any]) -> str | None:
    address = first_address(properties)
    if not address:
        return None
    for key in ("locality", "city"):
        value = address.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def address_state_code(properties: dict[str, Any]) -> str | None:
    address = first_address(properties)
    if not address:
        return None
    candidates: list[str] = []
    for key in ("region", "state", "region_code"):
        candidates.extend(string_values(address.get(key)))
    # Some Overture releases expose administrative levels as a nested structure.
    candidates.extend(string_values(address.get("address_levels")))
    upper_values = {value.strip().upper().replace(" ", "_") for value in candidates if value and value.strip()}
    for code, aliases in STATE_ALIASES.items():
        normalized_aliases = {alias.upper().replace(" ", "_") for alias in aliases}
        if upper_values & normalized_aliases:
            return code
    return None


def taxonomy_values(properties: dict[str, Any]) -> list[str]:
    values: list[str] = []
    for key in ("basic_category", "taxonomy", "categories"):
        values.extend(string_values(properties.get(key)))
    return list(dict.fromkeys(v.strip() for v in values if v and v.strip()))[:30]


def normalized_search_text(name: str, website: str, taxonomy: list[str]) -> str:
    return " ".join([name, website, *taxonomy]).lower().replace("_", " ").replace("-", " ")


def normalized_taxonomy(taxonomy: list[str]) -> set[str]:
    return {value.strip().lower().replace("-", "_").replace(" ", "_") for value in taxonomy if value.strip()}


def has_any_pattern(patterns: list[str], text: str) -> bool:
    return any(re.search(pattern, text, flags=re.I) for pattern in patterns)


def segment_quality_allowed(slug: str, name: str, website: str, taxonomy: list[str]) -> bool:
    text = normalized_search_text(name, website, taxonomy)
    tax = normalized_taxonomy(taxonomy)
    if has_any_pattern(SEGMENT_EXCLUSIONS.get(slug, []), text):
        return False
    if tax & COMMON_NON_SERVICE_TAXONOMY:
        return False

    service_context = bool(tax & SERVICE_CONTEXT)
    name_or_domain_signal = has_any_pattern(SEGMENT_PATTERNS[slug], f"{name} {website}".lower())

    if slug == "commercial-roofing":
        strong_taxonomy = "roofing" in tax or "ceiling_and_roofing_repair_and_service" in tax
        return service_context and (strong_taxonomy or name_or_domain_signal)

    if slug == "pest-control":
        if tax & SUPPLY_MANUFACTURING_TAXONOMY or "retail" in tax or "damage_restoration" in tax:
            return False
        if "home_cleaning" in tax and not name_or_domain_signal:
            return False
        strong_taxonomy = "pest_control_service" in tax
        return service_context and (strong_taxonomy or name_or_domain_signal)

    if slug == "fire-protection":
        if tax & SUPPLY_MANUFACTURING_TAXONOMY or "retail" in tax or "damage_restoration" in tax:
            return False
        strong_taxonomy = "fire_protection_service" in tax
        return service_context and (strong_taxonomy or name_or_domain_signal)

    if slug == "commercial-plumbing":
        if tax & SUPPLY_MANUFACTURING_TAXONOMY or "retail" in tax or "damage_restoration" in tax:
            return False
        # Plumbing taxonomy is broad enough to include suppliers and fixture makers.
        # Requiring the company/domain itself to advertise plumbing/rooter/drain/sewer
        # keeps this prospect pool contractor/service oriented.
        return service_context and name_or_domain_signal

    return has_any_pattern(SEGMENT_PATTERNS[slug], text)


def matching_segments(name: str, website: str, taxonomy: list[str]) -> list[str]:
    text = normalized_search_text(name, website, taxonomy)
    matches: list[str] = []
    for slug, patterns in SEGMENT_PATTERNS.items():
        if not has_any_pattern(patterns, text):
            continue
        if segment_quality_allowed(slug, name, website, taxonomy):
            matches.append(slug)
    return matches


def parse_places(path: Path, region: Region) -> dict[str, list[dict[str, Any]]]:
    found: dict[str, list[dict[str, Any]]] = {slug: [] for slug in SEGMENT_PATTERNS}
    seen: dict[str, set[str]] = {slug: set() for slug in SEGMENT_PATTERNS}

    with path.open("r", encoding="utf-8") as handle:
        for raw in handle:
            raw = raw.strip()
            if not raw:
                continue
            try:
                feature = json.loads(raw)
            except json.JSONDecodeError:
                continue
            properties = feature.get("properties") if isinstance(feature, dict) else None
            if not isinstance(properties, dict):
                continue
            confidence = properties.get("confidence")
            try:
                confidence_value = float(confidence) if confidence is not None else 0.0
            except (TypeError, ValueError):
                confidence_value = 0.0
            if confidence_value < MIN_CONFIDENCE:
                continue
            operating_status = str(properties.get("operating_status") or "").lower()
            if operating_status == "permanently_closed":
                continue
            candidate_state = address_state_code(properties)
            if candidate_state is not None and candidate_state != region.state:
                continue
            website = first_website(properties)
            name = primary_name(properties)
            overture_id = str(properties.get("id") or feature.get("id") or "").strip()
            if not website or not name or not overture_id:
                continue
            taxonomy = taxonomy_values(properties)
            for slug in matching_segments(name, website, taxonomy):
                domain_key = re.sub(r"^https?://(?:www\.)?", "", website.lower()).split("/")[0]
                if not domain_key or domain_key in seen[slug]:
                    continue
                seen[slug].add(domain_key)
                found[slug].append({
                    "id": overture_id,
                    "name": name,
                    "website": website,
                    "city": locality(properties),
                    "confidence": confidence_value,
                    "basicCategory": str(properties.get("basic_category") or "") or None,
                    "taxonomy": taxonomy,
                })

    for slug in found:
        found[slug].sort(key=lambda row: float(row.get("confidence") or 0), reverse=True)
        found[slug] = found[slug][:MAX_PER_SEGMENT]
    return found


def download_region(region: Region, output: Path) -> None:
    bbox = f"{region.west},{region.south},{region.east},{region.north}"
    subprocess.run(
        ["overturemaps", "download", f"--bbox={bbox}", "-f", "geojsonseq", "--type=place", "-o", str(output)],
        check=True,
        timeout=300,
    )


def post_batch(token: str, region: Region, slug: str, candidates: list[dict[str, Any]]) -> dict[str, Any]:
    payload = json.dumps({
        "segment": slug,
        "geography": region.geography,
        "region": region.name,
        "candidates": candidates,
    }).encode("utf-8")
    request = urllib.request.Request(
        API_URL,
        data=payload,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": "ArborLine-Overture-Discovery/1.0",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Ingestion failed for {slug}: HTTP {exc.code}: {body[:500]}") from exc


def selected_regions(validation: bool, day_index: int) -> list[Region]:
    if validation:
        return [REGIONS["Illinois"][0]]
    return [regions[day_index % len(regions)] for regions in REGIONS.values()]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--validation", action="store_true")
    parser.add_argument("--day-index", type=int, required=True)
    args = parser.parse_args()

    token = os.environ.get("ARBORLINE_OIDC_TOKEN", "").strip()
    if not token:
        raise SystemExit("ARBORLINE_OIDC_TOKEN is required")

    all_results: list[dict[str, Any]] = []
    with tempfile.TemporaryDirectory(prefix="arborline-overture-") as temp_dir:
        root = Path(temp_dir)
        for region in selected_regions(args.validation, args.day_index):
            output = root / f"{region.state}-{region.name}.geojsonseq"
            print(f"Downloading Overture Places for {region.geography}/{region.name}")
            download_region(region, output)
            batches = parse_places(output, region)
            for slug, candidates in batches.items():
                # Posting an empty batch is intentional: it records source coverage for that segment/region.
                result = post_batch(token, region, slug, candidates)
                summary = result.get("result", {}) if isinstance(result, dict) else {}
                all_results.append({
                    "segment": slug,
                    "geography": region.geography,
                    "region": region.name,
                    "candidates": len(candidates),
                    "state": summary.get("state"),
                    "inserted": summary.get("inserted", 0),
                    "duplicates": summary.get("duplicates", 0),
                    "qualified": summary.get("qualified", 0),
                })

    print(json.dumps({"provider": "OVERTURE_MAPS", "results": all_results}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
