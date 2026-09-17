#!/usr/bin/env python3
"""One-time/public-data boost for newly activated ArborLine service verticals."""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

from connect_overture_discovery import REGIONS, download_region, parse_places, post_batch

BOOST_SEGMENTS = (
    "commercial-roofing",
    "pest-control",
    "fire-protection",
    "commercial-plumbing",
)

BOOST_REGIONS = (
    REGIONS["Illinois"][1],   # chicago-suburbs
    REGIONS["Indiana"][0],    # indianapolis
    REGIONS["Wisconsin"][0],  # milwaukee
)


def main() -> int:
    token = os.environ.get("ARBORLINE_OIDC_TOKEN", "").strip()
    if not token:
        raise SystemExit("ARBORLINE_OIDC_TOKEN is required")

    all_results: list[dict[str, object]] = []
    with tempfile.TemporaryDirectory(prefix="arborline-overture-new-verticals-") as temp_dir:
        root = Path(temp_dir)
        for region in BOOST_REGIONS:
            output = root / f"{region.state}-{region.name}.geojsonseq"
            print(f"Downloading Overture Places for boost {region.geography}/{region.name}")
            download_region(region, output)
            batches = parse_places(output, region)
            for slug in BOOST_SEGMENTS:
                candidates = batches.get(slug, [])
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

    print(json.dumps({"provider": "OVERTURE_MAPS", "mode": "NEW_VERTICAL_BOOST", "results": all_results}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
