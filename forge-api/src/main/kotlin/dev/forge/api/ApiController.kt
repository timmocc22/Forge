package dev.forge.api

import com.fasterxml.jackson.databind.JsonNode
import dev.forge.execution.*
import dev.forge.generation.GenerationGateway
import dev.forge.infrastructure.*
import dev.forge.projects.*
import java.util.UUID
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*

@RestController
@RequestMapping("/api", produces = [MediaType.APPLICATION_JSON_VALUE])
class ApiController(
    private val projects: ProjectService,
    private val conversations: ConversationService,
    private val commands: ProjectCommands,
    private val contracts: Contracts,
    private val gateway: GenerationGateway,
    private val config: ForgeConfig,
) {
    private fun json(value: JsonNode, status: Int = 200): ResponseEntity<String> =
        ResponseEntity.status(status).contentType(MediaType.APPLICATION_JSON).body(value.toString())

    private fun body(raw: String, schema: String? = null): JsonNode {
        requireApi(raw.length <= 4 * 1024 * 1024, "请求过大", 413)
        val input =
            try {
                parse(raw)
            } catch (_: Exception) {
                throw ApiError(400, "请求必须是有效 JSON")
            }
        requireApi(input.isObject, "请求必须是 JSON 对象")
        if (schema != null) contracts.check(schema, input)
        return input
    }

    private fun id(value: String): String =
        try {
            UUID.fromString(value).toString()
        } catch (_: Exception) {
            throw ApiError(400, "项目或任务标识无效")
        }

    private fun expected(input: JsonNode) {
        requireApi(
            input.path("expectedRevision").isIntegralNumber && input.i("expectedRevision") >= 0,
            "缺少有效版本号",
        )
    }

    private fun operation(input: JsonNode, key: String = "operationId") {
        id(input.s(key))
    }

    @GetMapping("/health")
    fun health() =
        json(
            obj(
                "status" to "ok",
                "provider" to config.provider,
                "version" to "0.1.0",
                "backend" to "kotlin",
            )
        )

    @GetMapping("/providers") fun providers() = json(gateway.catalog())

    @GetMapping("/openapi.json")
    fun openapi() =
        json(
            parse(
                javaClass.getResourceAsStream("/contracts/openapi.json")!!.bufferedReader().use {
                    it.readText()
                }
            )
        )

    @GetMapping("/contracts")
    fun schemas() =
        json(
            obj(
                "project" to contracts.schema("htmlProjectSchema"),
                "conversation" to contracts.schema("conversationSchema"),
            )
        )

    @GetMapping("/html-projects/storage/status")
    fun status() = json(obj("issues" to projects.store.issues))

    @GetMapping("/html-projects") fun list() = json(projects.list())

    @PostMapping("/html-projects")
    fun create(@RequestBody raw: String) =
        json(projects.create(body(raw, "createHtmlProjectSchema")), 201)

    @GetMapping("/html-projects/{id}")
    fun get(@PathVariable id: String) = json(projects.get(id(id)))

    @PatchMapping("/html-projects/{id}")
    fun save(@PathVariable id: String, @RequestBody raw: String) =
        json(projects.save(id(id), body(raw, "saveHtmlProjectSchema")))

    @PostMapping("/html-projects/{id}/archive")
    fun archive(@PathVariable id: String, @RequestBody raw: String): ResponseEntity<String> {
        val b = body(raw)
        expected(b)
        requireApi(b.path("archived").isBoolean, "缺少归档状态")
        return json(projects.archive(id(id), b))
    }

    @DeleteMapping("/html-projects/{id}")
    fun delete(@PathVariable id: String, @RequestBody raw: String): ResponseEntity<String> {
        val b = body(raw)
        expected(b)
        return json(projects.store.delete(id(id), b.i("expectedRevision")))
    }

    @PostMapping("/html-projects/{id}/duplicate")
    fun duplicate(@PathVariable id: String, @RequestBody raw: String): ResponseEntity<String> {
        val b = body(raw)
        expected(b)
        operation(b, "requestId")
        return json(projects.duplicate(id(id), b), 201)
    }

    @PostMapping("/html-projects/{id}/undo")
    fun undo(@PathVariable id: String, @RequestBody raw: String): ResponseEntity<String> {
        val b = body(raw)
        expected(b)
        operation(b)
        return json(projects.undo(id(id), b))
    }

    @PostMapping("/html-projects/{id}/runs")
    fun run(@PathVariable id: String, @RequestBody raw: String) =
        json(projects.start(id(id), body(raw, "runHtmlProjectSchema")), 202)

    @PostMapping("/html-projects/{id}/cancel")
    fun cancel(@PathVariable id: String) = json(projects.cancel(id(id)))

    @GetMapping("/html-projects/{id}/conversation")
    fun conversation(@PathVariable id: String) = json(conversations.get(id(id)))

    @PostMapping("/html-projects/{id}/conversation/stop")
    fun stop(@PathVariable id: String) = json(conversations.stop(id(id)))

    @PostMapping("/html-projects/{id}/questions")
    fun ask(@PathVariable id: String, @RequestBody raw: String) =
        json(conversations.ask(id(id), body(raw, "askHtmlSceneSchema")))

    @GetMapping("/html-projects/{id}/commands")
    fun queue(@PathVariable id: String) = json(commands.list(id(id)))

    @PostMapping("/html-projects/{id}/commands")
    fun enqueue(@PathVariable id: String, @RequestBody raw: String) =
        json(commands.enqueue(id(id), body(raw, "enqueueProjectCommandSchema")), 202)

    @PatchMapping("/html-projects/{id}/commands/{commandId}")
    fun change(
        @PathVariable id: String,
        @PathVariable commandId: String,
        @RequestBody raw: String,
    ) = json(commands.change(id(id), id(commandId), body(raw).s("action")))

    @DeleteMapping("/html-projects/{id}/commands")
    fun clear(@PathVariable id: String) = json(commands.clear(id(id)))
}
