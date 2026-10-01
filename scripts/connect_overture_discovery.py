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

API_URL = "https://bjqkmcsduhazieuzegqi.supabase.co/functions/v1/connect-overture-ingest"
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
        Region("IL", "Illinois", "chicago", -88.95, 41.15, -87.20, 42.55),
        Region("IL", "Illinois", "rockford", -89.65, 41.75, -88.55, 42.65),
        Region("IL", "Illinois", "peoria-bloomington", -90.15, 40.20, -88.45, 41.25),
        Region("IL", "Illinois", "springfield-decatur", -90.25, 39.20, -88.35, 40.25),
        Region("IL", "Illinois", "quincy-western-il", -91.75, 39.50, -90.20, 40.70),
        Region("IL", "Illinois", "champaign-urbana", -88.85, 39.65, -87.55, 40.65),
        Region("IL", "Illinois", "metro-east", -90.70, 38.15, -89.35, 39.25),
        Region("IL", "Illinois", "southern-il", -90.65, 36.95, -87.45, 38.55),
    ],
    "Indiana": [
        Region("IN", "Indiana", "indianapolis", -86.85, 39.25, -85.35, 40.35),
        Region("IN", "Indiana", "fort-wayne", -85.65, 40.55, -84.45, 41.45),
        Region("IN", "Indiana", "south-bend-elkhart", -87.05, 41.25, -85.45, 42.15),
        Region("IN", "Indiana", "northwest-indiana", -87.65, 40.95, -86.25, 42.05),
        Region("IN", "Indiana", "lafayette-kokomo", -87.15, 40.05, -85.55, 41.15),
        Region("IN", "Indiana", "terre-haute", -88.05, 38.95, -86.35, 40.15),
        Region("IN", "Indiana", "evansville", -88.25, 37.45, -86.35, 38.65),
        Region("IN", "Indiana", "southern-indiana", -86.95, 37.65, -84.75, 39.25),
    ],
    "Ohio": [
        Region("OH", "Ohio", "cleveland", -82.75, 40.95, -80.95, 42.15),
        Region("OH", "Ohio", "columbus", -83.65, 39.35, -82.25, 40.65),
        Region("OH", "Ohio", "cincinnati-dayton", -85.05, 38.65, -83.15, 40.25),
        Region("OH", "Ohio", "toledo", -84.15, 40.95, -82.55, 42.15),
        Region("OH", "Ohio", "akron-canton", -82.05, 40.35, -80.95, 41.45),
        Region("OH", "Ohio", "youngstown", -81.35, 40.45, -79.75, 41.55),
        Region("OH", "Ohio", "mansfield-lima", -84.35, 39.95, -82.35, 41.25),
        Region("OH", "Ohio", "southeast-ohio", -82.65, 38.35, -80.35, 40.35),
    ],
}

STATE_ALIASES = {
    "IL": {"IL", "ILLINOIS", "US-IL", "US_IL"},
    "IN": {"IN", "INDIANA", "US-IN", "US_IN"},
    "OH": {"OH", "OHIO", "US-OH", "US_OH"},
}

SEGMENTS = {
    "commercial-cleaning": {
        "positive": {"janitorial", "janitorial service", "commercial cleaning", "office cleaning", "building cleaning", "cleaning service"},
        "negative": {"carpet cleaning", "house cleaning", "maid service", "dry cleaning", "laundromat", "window cleaning"},
    },
    "hvac-commercial-mechanical": {
        "positive": {"hvac", "air conditioning", "heating contractor", "mechanical contractor", "commercial hvac", "air conditioning contractor"},
        "negative": {"appliance repair", "fireplace", "chimney", "duct cleaning"},
    },
    "plumbing-commercial": {
        "positive": {"plumber", "plumbing contractor", "commercial plumbing", "plumbing service"},
        "negative": {"septic", "portable toilet", "drain cleaner"},
    },
    "landscaping-commercial": {
        "positive": {"landscaper", "landscaping", "landscape contractor", "lawn service", "grounds maintenance"},
        "negative": {"garden center", "nursery", "tree farm", "florist"},
    },
}


def normalize_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def collect_taxonomy(row: dict[str, Any]) -> list[str]:
    values: list[str] = []
    categories = row.get("categories") or {}
    if isinstance(categories, dict):
        for key in ("primary", "alternate"):
            raw = categories.get(key)
            if isinstance(raw, list):
                values.extend(normalize_text(item) for item in raw)
            elif raw:
                values.append(normalize_text(raw))
    for key in ("basic_category", "basicCategory"):
        raw = row.get(key)
        if raw:
            values.append(normalize_text(raw))
    return [value for value in values if value][:20]


def category_text(row: dict[str, Any]) -> str:
    return " | ".join(collect_taxonomy(row)).lower()


def website_from_row(row: dict[str, Any]) -> str | None:
    for key in ("websites", "website"):
        raw = row.get(key)
        if isinstance(raw, list):
            for value in raw:
                if isinstance(value, str) and value.startswith(("http://", "https://")):
                    return value
        elif isinstance(raw, str) and raw.startswith(("http://", "https://")):
            return raw
    return None


def name_from_row(row: dict[str, Any]) -> str:
    names = row.get("names") or {}
    if isinstance(names, dict):
        primary = names.get("primary")
        if primary:
            return normalize_text(primary)
        common = names.get("common")
        if isinstance(common, list) and common:
            first = common[0]
            if isinstance(first, dict):
                return normalize_text(first.get("value"))
            return normalize_text(first)
    return normalize_text(row.get("name"))


def address_fields(row: dict[str, Any]) -> tuple[str | None, str | None]:
    addresses = row.get("addresses")
    if not isinstance(addresses, list):
        addresses = []
    for address in addresses:
        if not isinstance(address, dict):
            continue
        city = normalize_text(address.get("locality") or address.get("city")) or None
        state = normalize_text(address.get("region") or address.get("state")) or None
        if city or state:
            return city, state
    return None, None


def confidence_from_row(row: dict[str, Any]) -> float | None:
    for key in ("confidence", "confidence_score"):
        raw = row.get(key)
        try:
            return float(raw) if raw is not None else None
        except (TypeError, ValueError):
            pass
    return None


def segment_match(row: dict[str, Any], slug: str) -> bool:
    rules = SEGMENTS[slug]
    text = category_text(row)
    if not text:
        return False
    if any(term in text for term in rules["negative"]):
        return False
    return any(term in text for term in rules["positive"])


def parse_places(path: Path, region: Region) -> dict[str, list[dict[str, Any]]]:
    batches: dict[str, list[dict[str, Any]]] = {slug: [] for slug in SEGMENTS}
    seen_by_segment: dict[str, set[str]] = {slug: set() for slug in SEGMENTS}
    aliases = STATE_ALIASES.get(region.state, {region.state})

    with path.open("r", encoding="utf-8") as handle:
        for raw_line in handle:
            try:
                row = json.loads(raw_line)
            except json.JSONDecodeError:
                continue
            if not isinstance(row, dict):
                continue
            website = website_from_row(row)
            name = name_from_row(row)
            if not website or not name:
                continue
            confidence = confidence_from_row(row)
            if confidence is not None and confidence < MIN_CONFIDENCE:
                continue
            city, state = address_fields(row)
            if state and state.upper() not in aliases:
                continue
            taxonomy = collect_taxonomy(row)
            for slug in SEGMENTS:
                if len(batches[slug]) >= MAX_PER_SEGMENT or not segment_match(row, slug):
                    continue
                key = website.lower().rstrip("/")
                if key in seen_by_segment[slug]:
                    continue
                seen_by_segment[slug].add(key)
                batches[slug].append({
                    "id": normalize_text(row.get("id"))[:180],
                    "name": name[:180],
                    "website": website[:500],
                    "city": city,
                    "confidence": confidence,
                    "basicCategory": taxonomy[0] if taxonomy else None,
                    "taxonomy": taxonomy,
                })
    return batches


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

    results: list[dict[str, Any]] = []
    with tempfile.TemporaryDirectory(prefix="arborline-overture-") as temp_dir:
        root = Path(temp_dir)
        for region in selected_regions(args.validation, args.day_index):
            output = root / f"{region.state}-{region.name}.geojsonseq"
            print(f"Downloading Overture Places for {region.geography}/{region.name}")
            download_region(region, output)
            batches = parse_places(output, region)
            for slug, candidates in batches.items():
                result = post_batch(token, region, slug, candidates)
                summary = result.get("result", {}) if isinstance(result, dict) else {}
                results.append({
                    "state": region.state,
                    "region": region.name,
                    "segment": slug,
                    "candidates": len(candidates),
                    "state_result": summary.get("state"),
                    "inserted": summary.get("inserted", 0),
                    "duplicates": summary.get("duplicates", 0),
                    "qualified": summary.get("qualified", 0),
                })

    print(json.dumps({
        "provider": "OVERTURE_MAPS",
        "mode": "PUBLIC_NATIVE_ONLY",
        "results": results,
        "providerSpend": 0,
        "messagesSent": 0,
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
