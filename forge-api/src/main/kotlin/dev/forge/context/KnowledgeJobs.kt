package dev.forge.context

import com.fasterxml.jackson.databind.JsonNode
import dev.forge.execution.Control
import dev.forge.infrastructure.*
import java.util.Base64
import org.springframework.stereotype.Service

/** Project authorization and API composition; indexing jobs belong to the knowledge service. */
@Service
class KnowledgeJobs(private val store: ProjectStore, private val client: KnowledgeClient) {
    fun requireProject(id: String) {
        store.get(id)
    }

    fun list(id: String): JsonNode {
        requireProject(id)
        return client.request(
            "GET",
            "/internal/v1/projects/$id/documents",
            null,
            Control(id, "knowledge"),
        )
    }

    fun jobs(id: String): JsonNode {
        requireProject(id)
        return if (client.enabled) client.listJobs(id) else arr()
    }

    fun enqueue(
        id: String,
        requestId: String,
        documentId: String,
        filename: String,
        mediaType: String,
        bytes: ByteArray,
    ): JsonNode {
        requireProject(id)
        requireApi(bytes.size <= 10 * 1024 * 1024, "文档超过 10MB", 413)
        requireApi(filename.length in 1..240, "文档名称无效")
        client.submitJob(
            id,
            obj(
                "request_id" to requestId,
                "project_id" to id,
                "document_id" to documentId,
                "filename" to filename,
                "media_type" to mediaType,
                "content_base64" to Base64.getEncoder().encodeToString(bytes),
            ),
        )
        return client.listJobs(id)
    }

    fun retry(id: String, jobId: String): JsonNode {
        requireProject(id)
        client.request(
            "POST",
            "/internal/v1/projects/$id/jobs/$jobId/retry",
            null,
            Control(id, "knowledge"),
        )
        return client.listJobs(id)
    }

    fun remove(id: String, documentId: String): JsonNode {
        requireProject(id)
        return client.request(
            "DELETE",
            "/internal/v1/projects/$id/documents/$documentId",
            null,
            Control(id, "knowledge"),
        )
    }
}
