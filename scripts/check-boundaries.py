#!/usr/bin/env python3
import json
import zipfile
from pathlib import Path

root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / "forge-web/package.json").read_text())
for name, command in manifest["scripts"].items():
    assert not any(
        term in command for term in ("gradlew", "../forge-api", "../forge-knowledge", "uv run")
    ), name
for filename in ("build.gradle.kts", "settings.gradle.kts"):
    build = (root / "forge-api" / filename).read_text()
    assert not any(
        term in build for term in ("../forge-web", "../forge-knowledge", "apps/web/dist")
    )
pyproject = (root / "forge-knowledge/pyproject.toml").read_text()
assert "../forge-api" not in pyproject and "../forge-web" not in pyproject
jar = root / "forge-api/build/libs/forge-api-0.1.0.jar"
if jar.exists():
    with zipfile.ZipFile(jar) as archive:
        assert not any(name.startswith("BOOT-INF/classes/static/") for name in archive.namelist())
print("Independent application build boundaries passed")
