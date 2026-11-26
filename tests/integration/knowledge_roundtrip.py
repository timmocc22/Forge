"""Exercise Kotlin -> FastAPI -> LlamaIndex -> storage with a local embedding fixture.

No paid provider or downloaded model is used. Run with the knowledge service's uv environment.
"""

import json
import os
import socket
import subprocess
import tempfile
import threading
import time
from contextlib import ExitStack
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from uuid import uuid4

import httpx
import uvicorn
from forge_knowledge.app import create_app
from forge_knowledge.models import Settings


class EmbeddingFixture(BaseHTTPRequestHandler):
    def do_POST(self):
        data = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        result = {
            "data": [
                {
                    "index": i,
                    "embedding": [
                        float("数学" in text) + 0.01,
                        float("历史" in text) + 0.01,
                        0.1,
                    ],
                }
                for i, text in enumerate(data["input"])
            ]
        }
        encoded = json.dumps(result).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, *args):
        pass


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def wait_ready(url):
    for _ in range(200):
        try:
            if httpx.get(url, timeout=1).status_code == 200:
                return
        except httpx.HTTPError:
            pass
        time.sleep(0.1)
    raise AssertionError(f"Service did not start: {url}")


def main():
    root = Path(__file__).resolve().parents[2]
    with (
        tempfile.TemporaryDirectory(prefix="forge-rag-") as directory,
        ExitStack() as resources,
    ):
        fixture = ThreadingHTTPServer(("127.0.0.1", 0), EmbeddingFixture)
        threading.Thread(target=fixture.serve_forever, daemon=True).start()
        knowledge_port, api_port = free_port(), free_port()
        settings = Settings(
            token="integration-fixture-token",
            database_url=f"sqlite:///{directory}/knowledge.db",
            embedding_base_url=f"http://127.0.0.1:{fixture.server_port}/v1",
            embedding_model="fixture",
            embedding_dimension=3,
        )
        server = uvicorn.Server(
            uvicorn.Config(
                create_app(settings),
                host="127.0.0.1",
                port=knowledge_port,
                log_level="error",
            )
        )
        thread = threading.Thread(target=server.run, daemon=True)
        thread.start()
        wait_ready(f"http://127.0.0.1:{knowledge_port}/health")
        env = {
            **os.environ,
            "PORT": str(api_port),
            "DATA_DIR": directory + "/kotlin",
            "PROVIDER": "demo",
            "KNOWLEDGE_URL": f"http://127.0.0.1:{knowledge_port}",
            "KNOWLEDGE_TOKEN": "integration-fixture-token",
        }
        java = os.environ.get("FORGE_JAVA_BIN", "java")
        log = resources.enter_context(open(directory + "/kotlin.log", "w+"))
        process = subprocess.Popen(
            [
                java,
                "--enable-native-access=ALL-UNNAMED",
                "-jar",
                str(root / "forge-api/build/libs/forge-api-0.1.0.jar"),
            ],
            cwd=root,
            env=env,
            stdout=log,
            stderr=log,
        )
        try:
            wait_ready(f"http://127.0.0.1:{api_port}/api/health")
            with httpx.Client(base_url=f"http://127.0.0.1:{api_port}/api", timeout=30) as client:

                def project():
                    response = client.post(
                        "/html-projects",
                        json={
                            "requestId": str(uuid4()),
                            "brief": "数学课堂",
                            "sourceHtml": "<html><body><h1>分数</h1></body></html>",
                        },
                    )
                    assert response.status_code == 201, response.text
                    return response.json()["id"]

                a, b = project(), project()
                request_id, document_id = str(uuid4()), str(uuid4())
                response = client.post(
                    f"/html-projects/{a}/documents",
                    data={"requestId": request_id, "documentId": document_id},
                    files={
                        "file": (
                            "lesson.md",
                            "数学分数表示整体的一部分。".encode(),
                            "text/markdown",
                        )
                    },
                )
                assert response.status_code == 202, response.text
                for _ in range(100):
                    jobs = client.get(f"/html-projects/{a}/document-jobs").json()
                    if jobs[0]["status"] not in ("queued", "running"):
                        break
                    time.sleep(0.1)
                assert jobs[0]["status"] == "completed", jobs
                assert "payload" not in jobs[0], "Internal file references must stay private"
                docs = client.get(f"/html-projects/{a}/documents").json()
                assert len(docs) == 1 and docs[0]["id"] == document_id, docs
                found = client.post(
                    f"/html-projects/{a}/knowledge/search", json={"query": "数学分数"}
                )
                assert found.status_code == 200, found.text
                rows = found.json()
                assert rows and rows[0]["projectId"] == a and rows[0]["source"] == "lesson.md", rows
                assert "整体" in rows[0]["content"]
                assert (
                    client.post(
                        f"/html-projects/{b}/knowledge/search",
                        json={"query": "数学分数"},
                    ).json()
                    == []
                )
                assert (
                    client.delete(f"/html-projects/{b}/documents/{document_id}").status_code == 200
                )
                assert len(client.get(f"/html-projects/{a}/documents").json()) == 1
                assert (
                    client.delete(f"/html-projects/{a}/documents/{document_id}").status_code == 200
                )
                assert (
                    client.post(
                        f"/html-projects/{a}/knowledge/search",
                        json={"query": "数学分数"},
                    ).json()
                    == []
                )
            print(
                "Kotlin / FastAPI / LlamaIndex roundtrip passed: durable ingest, retrieval, citations, project isolation and deletion"
            )
        except Exception:
            log.flush()
            log.seek(0)
            print(log.read()[-5000:])
            raise
        finally:
            process.terminate()
            process.wait(timeout=20)
            log.close()
            server.should_exit = True
            thread.join(timeout=5)
            fixture.shutdown()


if __name__ == "__main__":
    main()
