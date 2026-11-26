#!/usr/bin/env python3
"""Create missing local configs; never overwrite existing settings or credentials."""

import secrets
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read_env(path):
    if not path.exists():
        return {}
    return dict(
        line.split("=", 1)
        for line in path.read_text().splitlines()
        if "=" in line and not line.lstrip().startswith("#")
    )


api = ROOT / "forge-api/.env"
knowledge = ROOT / "forge-knowledge/.env"
existing = [read_env(api).get("KNOWLEDGE_TOKEN"), read_env(knowledge).get("KNOWLEDGE_TOKEN")]
configured = [token for token in existing if token]
if len(set(configured)) > 1:
    raise SystemExit("API and knowledge tokens differ. Align them explicitly before local startup.")
token = configured[0] if configured else secrets.token_urlsafe(32)
for name in ("forge-web", "forge-api", "forge-knowledge"):
    path = ROOT / name / ".env"
    if path.exists():
        print(f"{name}: retained existing .env")
        continue
    content = (path.parent / ".env.example").read_text()
    if name == "forge-api":
        content = content.replace("KNOWLEDGE_TOKEN=\n", f"KNOWLEDGE_TOKEN={token}\n")
    if name == "forge-knowledge":
        content = content.replace("replace-with-a-shared-service-token", token)
    path.write_text(content)
    path.chmod(0o600)
    print(f"{name}: created local .env")
print("Local configs ready. Configure embedding settings in forge-knowledge/.env before indexing.")
