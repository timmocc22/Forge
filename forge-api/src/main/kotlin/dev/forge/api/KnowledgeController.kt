package dev.forge.api

import dev.forge.context.KnowledgeClient
import dev.forge.context.KnowledgeJobs
import dev.forge.execution.Control
import dev.forge.infrastructure.*
import java.util.UUID
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*
import org.springframework.web.multipart.MultipartFile

@RestController
@RequestMapping("/api/html-projects/{id}", produces = [MediaType.APPLICATION_JSON_VALUE])
class KnowledgeController(private val jobs: KnowledgeJobs, private val client: KnowledgeClient) {
    private fun id(value: String) =
        try {
            UUID.fromString(value).toString()
        } catch (_: Exception) {
            throw ApiError(400, "标识无效")
        }

    private fun json(value: Any, status: Int = 200) =
        ResponseEntity.status(status).contentType(MediaType.APPLICATION_JSON).body(value.toString())

    @PostMapping("/knowledge/search", consumes = [MediaType.APPLICATION_JSON_VALUE])
    fun search(@PathVariable id: String, @RequestBody raw: String): ResponseEntity<String> {
        val projectId = id(id)
        jobs.requireProject(projectId)
        val input =
            try {
                parse(raw)
            } catch (_: Exception) {
                throw ApiError(400, "请求必须是有效 JSON")
            }
        requireApi(input.s("query").trim().length in 1..8000, "检索问题长度应为 1–8000 字")
        return json(
            arr(client.retrieve(projectId, input.s("query"), Control(projectId, "knowledge")))
        )
    }

    @GetMapping("/documents") fun list(@PathVariable id: String) = json(jobs.list(id(id)))

    @GetMapping("/document-jobs") fun queue(@PathVariable id: String) = json(jobs.jobs(id(id)))

    @PostMapping("/documents", consumes = [MediaType.MULTIPART_FORM_DATA_VALUE])
    fun upload(
        @PathVariable id: String,
        @RequestParam requestId: String,
        @RequestParam documentId: String,
        @RequestParam file: MultipartFile,
    ) =
        json(
            jobs.enqueue(
                id(id),
                id(requestId),
                id(documentId),
                file.originalFilename ?: "document",
                file.contentType ?: "application/octet-stream",
                file.bytes,
            ),
            202,
        )

    @PostMapping("/document-jobs/{jobId}/retry")
    fun retry(@PathVariable id: String, @PathVariable jobId: String) =
        json(jobs.retry(id(id), id(jobId)))

    @DeleteMapping("/documents/{documentId}")
    fun remove(@PathVariable id: String, @PathVariable documentId: String) =
        json(jobs.remove(id(id), id(documentId)))
}
