package dev.forge.context

import com.fasterxml.jackson.databind.JsonNode
import dev.forge.execution.Control
import dev.forge.infrastructure.*
import java.net.URI
import java.net.http.*
import java.time.Duration
import org.springframework.stereotype.Component

@Component
class KnowledgeClient(private val config: ForgeConfig) {
    private val contract = KnowledgeContract()
    private val client =
        HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .followRedirects(HttpClient.Redirect.NEVER)
            .build()
    val enabled
        get() = config.get("KNOWLEDGE_URL").isNotBlank()

    fun request(method: String, path: String, body: JsonNode?, control: Control): JsonNode {
        requireApi(enabled && config.get("KNOWLEDGE_TOKEN").isNotBlank(), "知识库服务尚未配置", 503)
        val uri = URI(config.get("KNOWLEDGE_URL").trimEnd('/') + path)
        requireApi(
            uri.scheme == "https" ||
                uri.scheme == "http" &&
                    (uri.host in listOf("127.0.0.1", "localhost", "::1") ||
                        config.get("KNOWLEDGE_ALLOW_HTTP") == "true"),
            "知识库服务需要 HTTPS 或本机地址",
            503,
        )
        val req =
            HttpRequest.newBuilder(uri)
                .timeout(Duration.ofSeconds(180))
                .header("Authorization", "Bearer ${config.get("KNOWLEDGE_TOKEN")}")
                .header("Content-Type", "application/json")
                .method(
                    method,
                    if (body != null) HttpRequest.BodyPublishers.ofString(body.toString())
                    else HttpRequest.BodyPublishers.noBody(),
                )
                .build()
        try {
            val response =
                control.await(client.sendAsync(req, HttpResponse.BodyHandlers.ofString()))
            requireApi(
                response.statusCode() in 200..299,
                "知识库服务处理失败（HTTP ${response.statusCode()}）",
                503,
            )
            requireApi(response.body().length <= 2_000_000, "知识库响应过大", 503)
            return parse(response.body())
        } catch (e: ApiError) {
            throw e
        } catch (_: Exception) {
            control.check()
            throw ApiError(503, "知识库服务暂时不可用")
        }
    }

    fun submitJob(projectId: String, input: JsonNode) {
        contract.check("Ingest", input)
        val result = request("POST", "/internal/v1/jobs", input, Control(projectId, "knowledge"))
        contract.check("JobView", result)
        requireApi(result.s("project_id") == projectId, "文档作业不属于当前项目", 503)
    }

    fun listJobs(projectId: String): JsonNode {
        val rows =
            request(
                "GET",
                "/internal/v1/projects/$projectId/jobs",
                null,
                Control(projectId, "knowledge"),
            )
        requireApi(rows.isArray, "知识库作业列表格式错误", 503)
        return arr(
            rows.map { row ->
                contract.check("JobView", row)
                requireApi(row.s("project_id") == projectId, "文档作业不属于当前项目", 503)
                obj(
                    "id" to row.s("id"),
                    "documentId" to row.s("document_id"),
                    "filename" to row.s("filename"),
                    "status" to row.s("status"),
                    "createdAt" to row.s("created_at"),
                    "updatedAt" to row.s("updated_at"),
                    "error" to row.s("error"),
                    "result" to row.get("result"),
                )
            }
        )
    }

    fun retrieve(projectId: String, query: String, c: Control): List<JsonNode> {
        if (!enabled) return emptyList()
        val rows =
            request(
                "POST",
                "/internal/v1/retrieve",
                obj("project_id" to projectId, "query" to query, "limit" to 8, "rerank" to true),
                c,
            )
        requireApi(rows.isArray, "知识库结果格式错误", 503)
        var budget = 16000
        val ids = mutableSetOf<String>()
        return rows
            .mapNotNull { r ->
                contract.check("Evidence", r)
                requireApi(r.s("project_id") == projectId, "检索结果不属于当前项目", 503)
                if (budget <= 0 || !ids.add(r.s("id"))) null
                else {
                    val content = r.s("content").take(budget)
                    budget -= content.length
                    obj(
                        "id" to r.s("id"),
                        "projectId" to projectId,
                        "source" to r.s("source"),
                        "content" to content,
                        "score" to r.get("score"),
                        "page" to r.get("page"),
                    )
                }
            }
            .take(8)
    }
}
