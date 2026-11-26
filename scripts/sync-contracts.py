#!/usr/bin/env python3
"""Explicit development operation; never invoked by an application's build."""

import argparse
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PAIRS = [
    (
        ROOT / "forge-api/src/main/resources/contracts/openapi.json",
        ROOT / "forge-web/contracts/forge-api.v1.openapi.json",
    ),
    (
        ROOT / "forge-knowledge/contracts/openapi.v1.json",
        ROOT / "forge-api/contracts/forge-knowledge.v1.openapi.json",
    ),
]
parser = argparse.ArgumentParser()
parser.add_argument("--check", action="store_true")
args = parser.parse_args()
for producer, consumer in PAIRS:
    if args.check:
        if json.loads(producer.read_text()) != json.loads(consumer.read_text()):
            raise SystemExit(f"Contract snapshot differs: {consumer.relative_to(ROOT)}")
    else:
        consumer.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(producer, consumer)
print("Contract snapshots checked" if args.check else "Contract snapshots synchronized explicitly")
