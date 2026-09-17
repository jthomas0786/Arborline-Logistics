#!/usr/bin/env python3
"""Bounded Overture discovery for the active Tier-1 ArborLine metro expansion.

This worker intentionally scans only two expansion metros per run. It uses the
same public Overture filtering rules as the core discovery worker and posts to
a market-aware ingestion endpoint. It never performs contact enrichment,
provider spend, outreach approval, queueing, or sending.
"""

from __future__ import annotations

import argparse
import json
import os
import tempfile
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

import connect_overture_discovery as core

API_URL = "https://www.arborlineconnect.com/api/cron/connect-tier1-expansion-discovery"

# parse_places validates the candidate address-state against this shared map.
core.STATE_ALIASES.update({
    "TX": {"TX", "TEXAS", "US-TX", "US_TX"},
    "GA": {"GA", "GEORGIA", "US-GA", "US_GA"},
    "AZ": {"AZ", "ARIZONA", "US-AZ", "US_AZ"},
    "DC": {"DC", "DISTRICT OF COLUMBIA", "US-DC", "US_DC"},
    "PA": {"PA", "PENNSYLVANIA", "US-PA", "US_PA"},
    "NC": {"NC", "NORTH CAROLINA", "US-NC", "US_NC"},
})

EXPANSION_REGIONS = [
    # One bounded core box per activated market. Multi-state metros intentionally
    # start with the core state/district; adjacent-state expansion can follow after
    # quality and throughput are proven.
    ("dallas-fort-worth", core.Region("TX", "Texas", "dallas-fort-worth", -97.75, 32.35, -96.35, 33.35)),
    ("houston", core.Region("TX", "Texas", "houston", -96.10, 29.30, -94.80, 30.25)),
    ("atlanta", core.Region("GA", "Georgia", "atlanta", -84.85, 33.35, -83.85, 34.25)),
    ("phoenix", core.Region("AZ", "Arizona", "phoenix", -112.60, 33.05, -111.40, 34.00)),
    ("washington-dc", core.Region("DC", "District of Columbia", "washington-dc", -77.25, 38.75, -76.85, 39.05)),
    ("philadelphia", core.Region("PA", "Pennsylvania", "philadelphia", -75.65, 39.65, -74.85, 40.25)),
    ("charlotte", core.Region("NC", "North Carolina", "charlotte", -81.15, 34.85, -80.45, 35.55)),
]


def post_batch(token: str, market_slug: str, region: core.Region, slug: str, candidates: list[dict[str, Any]]) -> dict[str, Any]:
    payload = json.dumps({
        "market": market_slug,
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
            "User-Agent": "ArborLine-Tier1-Expansion-Discovery/1.0",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Tier-1 ingestion failed for {market_slug}/{slug}: HTTP {exc.code}: {body[:500]}") from exc


def selected_regions(day_index: int) -> list[tuple[str, core.Region]]:
    total = len(EXPANSION_REGIONS)
    first = day_index % total
    second = (day_index + 3) % total
    return [EXPANSION_REGIONS[first], EXPANSION_REGIONS[second]]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--day-index", type=int, required=True)
    args = parser.parse_args()

    token = os.environ.get("ARBORLINE_OIDC_TOKEN", "").strip()
    if not token:
        raise SystemExit("ARBORLINE_OIDC_TOKEN is required")

    all_results: list[dict[str, Any]] = []
    with tempfile.TemporaryDirectory(prefix="arborline-tier1-overture-") as temp_dir:
        root = Path(temp_dir)
        for market_slug, region in selected_regions(args.day_index):
            output = root / f"{region.state}-{market_slug}.geojsonseq"
            print(f"Downloading Overture Places for Tier-1 market {market_slug}")
            core.download_region(region, output)
            batches = core.parse_places(output, region)
            for slug, candidates in batches.items():
                result = post_batch(token, market_slug, region, slug, candidates)
                summary = result.get("result", {}) if isinstance(result, dict) else {}
                all_results.append({
                    "market": market_slug,
                    "segment": slug,
                    "geography": region.geography,
                    "candidates": len(candidates),
                    "state": summary.get("state"),
                    "inserted": summary.get("inserted", 0),
                    "duplicates": summary.get("duplicates", 0),
                    "qualified": summary.get("qualified", 0),
                    "marketAssigned": summary.get("marketAssigned", 0),
                })

    print(json.dumps({
        "provider": "OVERTURE_MAPS",
        "mode": "TIER1_EXPANSION_NATIVE_PUBLIC_ONLY",
        "marketsScanned": [market for market, _ in selected_regions(args.day_index)],
        "results": all_results,
        "providerSpend": 0,
        "messagesSent": 0,
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
