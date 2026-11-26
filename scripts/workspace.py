#!/usr/bin/env python3
"""Optional local orchestration. Applications do not import this module."""

import argparse
import os
import signal
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB, API, KNOWLEDGE = (ROOT / name for name in ("forge-web", "forge-api", "forge-knowledge"))
parser = argparse.ArgumentParser()
parser.add_argument("mode", choices=["dev", "start", "e2e", "test"])
parser.add_argument(
    "--knowledge", action="store_true", help="Also start the configured Python service"
)
args = parser.parse_args()
children = []


def run(command, directory, **options):
    subprocess.run(command, cwd=directory, check=True, **options)


def start(command, directory, env=None):
    process = subprocess.Popen(command, cwd=directory, env=env, start_new_session=True)
    children.append(process)
    return process


def ready(url):
    for _ in range(300):
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                if response.status == 200:
                    return
        except OSError:
            pass
        if any(process.poll() is not None for process in children):
            raise RuntimeError("A service exited before becoming ready")
        time.sleep(0.1)
    raise RuntimeError(f"Service did not become ready: {url}")


def cleanup():
    for process in reversed(children):
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGTERM)
    for process in reversed(children):
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()


try:
    if args.mode == "test":
        run(["pnpm", "build"], WEB)
        run(["pnpm", "test"], WEB)
        run(["./gradlew", "build"], API)
        run(["uv", "run", "pytest", "tests", "-q"], KNOWLEDGE)
        run(["python3", "scripts/sync-contracts.py", "--check"], ROOT)
    elif args.mode == "e2e":
        # Only this integration launcher knows the other application's artifact location.
        jar = API / "build/libs/forge-api-0.1.0.jar"
        if not jar.exists():
            raise RuntimeError("Build forge-api and forge-web before E2E")
        with tempfile.TemporaryDirectory(prefix="forge-e2e-") as data:
            env = {
                **os.environ,
                "PORT": "3108",
                "DATA_DIR": data,
                "PROVIDER": "demo",
                "WEB_ORIGIN": "http://127.0.0.1:5188",
                "KNOWLEDGE_URL": "",
                "IMPORT_LEGACY_DIR": "",
            }
            java = str(Path(os.environ["JAVA_HOME"]) / "bin/java")
            start([java, "--enable-native-access=ALL-UNNAMED", "-jar", str(jar)], API, env)
            try:
                ready("http://127.0.0.1:3108/api/health")
                run(
                    ["pnpm", "test:e2e"],
                    WEB,
                    env={**os.environ, "E2E_API_URL": "http://127.0.0.1:3108"},
                )
            finally:
                cleanup()
                children.clear()
    else:
        api_env = dict(os.environ)
        if args.knowledge:
            api_env.setdefault("KNOWLEDGE_URL", "http://127.0.0.1:3017")
            start(
                [
                    "uv",
                    "run",
                    "uvicorn",
                    "forge_knowledge.app:create_app",
                    "--factory",
                    "--host",
                    "127.0.0.1",
                    "--port",
                    "3017",
                ],
                KNOWLEDGE,
            )
            ready("http://127.0.0.1:3017/health")
        if args.mode == "dev":
            start(["./gradlew", "bootRun", "--console=plain"], API, api_env)
            run(["pnpm", "build:packages"], WEB)
            start(["pnpm", "dev"], WEB)
        else:
            start(
                [
                    str(Path(os.environ["JAVA_HOME"]) / "bin/java"),
                    "--enable-native-access=ALL-UNNAMED",
                    "-jar",
                    str(API / "build/libs/forge-api-0.1.0.jar"),
                ],
                API,
                api_env,
            )
            start(["pnpm", "preview"], WEB)
        ready("http://127.0.0.1:3009/api/health")
        ready("http://127.0.0.1:5179")
        print("Forge web: http://127.0.0.1:5179", flush=True)
        while all(process.poll() is None for process in children):
            time.sleep(0.3)
        raise RuntimeError("A service exited; shutting down the local group")
except KeyboardInterrupt:
    pass
finally:
    cleanup()
