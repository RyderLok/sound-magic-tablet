#!/usr/bin/env python3
"""Migrate local sounds/*.wav + index.json → Supabase Storage + sounds table.

Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env (or environment).

Usage (from this directory, or Piko runtime copy):
  python migrate_local_to_supabase.py --dry-run
  python migrate_local_to_supabase.py
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys

import config
import sounds_store


async def _main(dry_run: bool) -> int:
    st = sounds_store.status()
    print(json.dumps(st, ensure_ascii=False, indent=2))
    if not config.supabase_configured():
        print(
            "\nRefusing to migrate: Supabase not configured.\n"
            "Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to .env, "
            "sync Mac runtime if needed, restart :8001, then re-run.",
            file=sys.stderr,
        )
        return 2

    result = await sounds_store.migrate_local_to_supabase(dry_run=dry_run)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if result.get("failed"):
        return 1
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="List what would migrate without uploading",
    )
    args = parser.parse_args()
    raise SystemExit(asyncio.run(_main(args.dry_run)))


if __name__ == "__main__":
    main()
