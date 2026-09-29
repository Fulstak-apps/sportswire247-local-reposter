#!/usr/bin/env python3
"""Run one worker stage with a hard deadline so a hung browser cannot stop launchd."""
import os
import signal
import subprocess
import sys


def main() -> int:
    if len(sys.argv) < 3:
        raise SystemExit("usage: run-with-timeout.py SECONDS COMMAND [ARG ...]")
    seconds = int(sys.argv[1])
    command = sys.argv[2:]
    process = subprocess.Popen(command, start_new_session=True)
    try:
        return process.wait(timeout=seconds)
    except subprocess.TimeoutExpired:
        # Collector subprocesses include Chrome/ffmpeg. Terminating the whole
        # process group prevents an orphan from retaining the worker lock.
        print(f"SportsWire stage timed out after {seconds}s: {' '.join(command)}", file=sys.stderr)
        os.killpg(process.pid, signal.SIGTERM)
        try:
            process.wait(timeout=15)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
        return 124


if __name__ == "__main__":
    raise SystemExit(main())
