#!/usr/bin/env python3
"""Run the local worker once, refusing a second overlapping launchd cycle."""
import fcntl
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
LOCK = ROOT / "runtime" / "state" / "worker.flock"
LOCK.parent.mkdir(parents=True, exist_ok=True)

with LOCK.open("w") as handle:
    try:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        print("SportsWire worker already running; skipping overlapping launchd cycle.", file=sys.stderr)
        raise SystemExit(0)
    environment = os.environ.copy()
    environment["SPORTSWIRE_WORKER_LOCK_HELD"] = "1"
    raise SystemExit(subprocess.run([sys.argv[1], *sys.argv[2:]], cwd=ROOT, env=environment).returncode)
