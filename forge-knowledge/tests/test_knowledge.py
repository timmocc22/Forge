import base64
import math
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from forge_knowledge.app import create_app
from forge_knowledge.models import Settings
from forge_knowledge.providers import Reranker


class TestEmbeddings:
    __test__ = False

    def __init__(self):
        self.calls = 0

    async def embed(self, texts):
        self.calls += 1
        return [[float("数学" in text) + 0.01, float("历史" in text) + 0.01, 0.1] for text in texts]


@pytest.fixture
def service(tmp_path):
    settings = Settings(
        token="test-secret",
        database_url=f"sqlite:///{tmp_path}/test.db",
        embedding_model="fixture",
        embedding_dimension=3,
    )
    embeddings = TestEmbeddings()
    app = create_app(settings, embeddings, Reranker(settings))
    with TestClient(app) as client:
        yield client, embeddings


def ingest(client, project, text="数学中的分数表示整体的一部分。", request=None, document=None):
    return client.post(
        "/internal/v1/documents",
        headers={"Authorization": "Bearer test-secret"},
        json={
            "request_id": request or str(uuid4()),
            "project_id": project,
            "document_id": document or str(uuid4()),
            "filename": "课堂资料.md",
            "media_type": "text/markdown",
            "content_base64": base64.b64encode(text.encode()).decode(),
        },
    )


def test_authentication_required(service):
    client, _ = service
    assert client.get(f"/internal/v1/projects/{uuid4()}/documents").status_code == 401


def test_ingest_retrieve_cites_and_isolates_projects(service):
    client, _ = service
    a, b = str(uuid4()), str(uuid4())
    first = ingest(client, a)
    assert first.status_code == 200, first.text
    assert ingest(client, b, "历史课的朝代年表。").status_code == 200
    response = client.post(
        "/internal/v1/retrieve",
        headers={"Authorization": "Bearer test-secret"},
        json={"project_id": a, "query": "数学分数"},
    )
    assert response.status_code == 200, response.text
    rows = response.json()
    assert rows and all(r["project_id"] == a for r in rows)
    assert rows[0]["source"] == "课堂资料.md"
    assert rows[0]["document_id"] == first.json()["document_id"]
    assert all(math.isfinite(r["score"]) for r in rows)


def test_idempotency_and_request_collision(service):
    client, embedding = service
    p, request, doc = str(uuid4()), str(uuid4()), str(uuid4())
    first = ingest(client, p, request=request, document=doc)
    assert first.status_code == 200, first.text
    calls = embedding.calls
    assert ingest(client, p, request=request, document=doc).json() == first.json()
    assert embedding.calls == calls
    assert ingest(client, p, text="其他材料", request=request, document=doc).status_code == 409


def test_update_replaces_chunks_and_delete_is_scoped(service):
    client, _ = service
    a, b, doc = str(uuid4()), str(uuid4()), str(uuid4())
    assert ingest(client, a, document=doc).status_code == 200
    updated = ingest(client, a, "历史资料替换旧文档。", document=doc)
    assert updated.status_code == 200, updated.text
    assert updated.json()["revision"] == 2
    headers = {"Authorization": "Bearer test-secret"}
    assert (
        client.delete(f"/internal/v1/projects/{b}/documents/{doc}", headers=headers).status_code
        == 200
    )
    assert len(client.get(f"/internal/v1/projects/{a}/documents", headers=headers).json()) == 1
    assert (
        client.delete(f"/internal/v1/projects/{a}/documents/{doc}", headers=headers).status_code
        == 200
    )
    assert client.get(f"/internal/v1/projects/{a}/documents", headers=headers).json() == []


def test_empty_text_rejected_without_partial_rows(service):
    client, _ = service
    p = str(uuid4())
    assert ingest(client, p, "   ").status_code == 422
    assert (
        client.get(
            f"/internal/v1/projects/{p}/documents", headers={"Authorization": "Bearer test-secret"}
        ).json()
        == []
    )


def test_html_never_executes_and_strips_scripts(service):
    _client, _ = service
    from forge_knowledge.parsing import parse_document

    documents = parse_document(
        b"<html><script>raise_error()</script><p>safe content</p></html>", "text/html", "a.html"
    )
    assert "raise_error" not in documents[0].text
    assert "safe content" in documents[0].text


def wait_job(client, project_id, job_id):
    import time

    for _ in range(100):
        rows = client.get(
            f"/internal/v1/projects/{project_id}/jobs",
            headers={"Authorization": "Bearer test-secret"},
        ).json()
        job = next(row for row in rows if row["id"] == job_id)
        if job["status"] not in ("queued", "running"):
            return job
        time.sleep(0.02)
    raise AssertionError("Indexing job did not finish")


def job_payload(project_id, request_id=None):
    return {
        "request_id": request_id or str(uuid4()),
        "project_id": project_id,
        "document_id": str(uuid4()),
        "filename": "lesson.md",
        "media_type": "text/markdown",
        "content_base64": base64.b64encode("数学分数资料".encode()).decode(),
    }


def test_python_owns_indexing_queue_and_idempotency(service):
    client, embeddings = service
    project = str(uuid4())
    payload = job_payload(project)
    response = client.post(
        "/internal/v1/jobs", headers={"Authorization": "Bearer test-secret"}, json=payload
    )
    assert response.status_code == 202, response.text
    completed = wait_job(client, project, payload["request_id"])
    assert completed["status"] == "completed", completed
    assert "payload" not in completed and "content_base64" not in completed
    calls = embeddings.calls
    duplicate = client.post(
        "/internal/v1/jobs", headers={"Authorization": "Bearer test-secret"}, json=payload
    )
    assert duplicate.status_code == 202
    assert duplicate.json()["status"] == "completed"
    assert embeddings.calls == calls
    collision = client.post(
        "/internal/v1/jobs",
        headers={"Authorization": "Bearer test-secret"},
        json={**payload, "filename": "other.md"},
    )
    assert collision.status_code == 409


def test_restart_requires_explicit_retry_and_preserves_job_input(tmp_path):
    settings = Settings(
        token="test-secret",
        database_url=f"sqlite:///{tmp_path}/jobs.db",
        embedding_model="fixture",
        embedding_dimension=3,
    )
    embeddings = TestEmbeddings()
    initial = create_app(settings, embeddings)
    project = str(uuid4())
    payload = job_payload(project)
    initial.state.store.submit_job(payload, 20)
    assert initial.state.store.claim_job()["id"] == payload["request_id"]
    initial.state.store.engine.dispose()
    restarted = create_app(settings, embeddings)
    with TestClient(restarted) as client:
        headers = {"Authorization": "Bearer test-secret"}
        rows = client.get(f"/internal/v1/projects/{project}/jobs", headers=headers).json()
        assert rows[0]["status"] == "failed"
        assert embeddings.calls == 0
        foreign = client.post(
            f"/internal/v1/projects/{uuid4()}/jobs/{payload['request_id']}/retry", headers=headers
        )
        assert foreign.status_code == 404
        retry = client.post(
            f"/internal/v1/projects/{project}/jobs/{payload['request_id']}/retry", headers=headers
        )
        assert retry.status_code == 200
        assert wait_job(client, project, payload["request_id"])["status"] == "completed"
        assert embeddings.calls == 1


def test_failed_indexing_job_can_retry_without_kotlin(service):
    from forge_knowledge.providers import ModelUnavailable

    client, embeddings = service
    original = embeddings.embed

    async def fail(texts):
        raise ModelUnavailable("fixture model unavailable")

    embeddings.embed = fail
    project = str(uuid4())
    payload = job_payload(project)
    headers = {"Authorization": "Bearer test-secret"}
    assert client.post("/internal/v1/jobs", headers=headers, json=payload).status_code == 202
    assert wait_job(client, project, payload["request_id"])["status"] == "failed"
    embeddings.embed = original
    assert (
        client.post(
            f"/internal/v1/projects/{project}/jobs/{payload['request_id']}/retry", headers=headers
        ).status_code
        == 200
    )
    assert wait_job(client, project, payload["request_id"])["status"] == "completed"
