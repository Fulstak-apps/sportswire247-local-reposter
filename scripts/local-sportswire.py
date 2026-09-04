#!/usr/bin/env python3
import argparse, json
from sportswire_local.newsroom import health, run

parser = argparse.ArgumentParser(description="SportsWire247 local autonomous newsroom")
parser.add_argument("--dry-run", action="store_true")
parser.add_argument("--health", action="store_true")
args = parser.parse_args()
print(json.dumps(health() if args.health else run(dry_run=args.dry_run), indent=2))
