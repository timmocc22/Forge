package dev.forge.infrastructure

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.databind.node.ArrayNode
import com.fasterxml.jackson.databind.node.ObjectNode
import com.networknt.schema.JsonSchemaFactory
import com.networknt.schema.SpecVersion
import java.security.MessageDigest
import java.time.Instant
import java.util.UUID
import org.springframework.stereotype.Component

val mapper = ObjectMapper()

fun obj(vararg pairs: Pair<String, Any?>): ObjectNode =
    mapper.createObjectNode().also { n ->
        pairs.forEach { (k, v) -> if (v != null) n.set<JsonNode>(k, mapper.valueToTree(v)) }
    }

fun arr(values: Iterable<Any?> = emptyList()): ArrayNode = mapper.valueToTree(values.toList())

fun parse(text: String): JsonNode = mapper.readTree(text)

fun JsonNode.s(key: String, default: String = "") = path(key).asText(default)

fun JsonNode.i(key: String, default: Int = 0) = path(key).asInt(default)

fun JsonNode.b(key: String, default: Boolean = false) = path(key).asBoolean(default)

fun JsonNode.o(key: String): ObjectNode = path(key) as ObjectNode

fun JsonNode.a(key: String): ArrayNode = path(key) as? ArrayNode ?: arr()

fun ObjectNode.v(key: String, value: Any?): ObjectNode {
    if (value == null) remove(key) else set<JsonNode>(key, mapper.valueToTree(value))
    return this
}

fun JsonNode.copyObject(): ObjectNode = deepCopy<ObjectNode>()

fun uid() = UUID.randomUUID().toString()

fun now() = Instant.now().toString()

fun sha(bytes: ByteArray) =
    MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

class ApiError(val status: Int, override val message: String, val code: String = "HTTP_$status") :
    RuntimeException(message)

fun requireApi(ok: Boolean, message: String, status: Int = 400) {
    if (!ok) throw ApiError(status, message)
}

fun revision(project: JsonNode, expected: Int) {
    requireApi(project.i("revision") == expected, "项目已在其他窗口更新，请重新载入后再修改。当前编辑内容仍保留。", 409)
    requireApi(project.path("run").s("status") != "running", "请先停止生成，再修改项目", 409)
}

@Component
class Contracts {
    private val schemas =
        parse(
            javaClass.getResourceAsStream("/contracts/schemas.json")!!.bufferedReader().readText()
        )
    private val factory = JsonSchemaFactory.getInstance(SpecVersion.VersionFlag.V7)

    fun schema(name: String): JsonNode = schemas[name] ?: error("Unknown contract $name")

    fun check(name: String, value: JsonNode): JsonNode {
        val errors = factory.getSchema(schema(name)).validate(value)
        requireApi(errors.isEmpty(), errors.take(5).joinToString("；") { it.message })
        if (name in listOf("htmlProjectContentSchema", "htmlProjectSchema")) {
            val content = if (name == "htmlProjectSchema") value.path("content") else value
            val ids = content.a("scenes").map { it.s("id") }
            requireApi(ids.size == ids.toSet().size, "页面标识不能重复")
        }
        if (name == "conversationSchema") {
            val messages = value.a("messages")
            requireApi(messages.size() % 2 == 0, "对话必须保存完整问答")
            requireApi(messages.map { it.s("id") }.toSet().size == messages.size(), "消息标识不能重复")
            messages.forEachIndexed { index, message ->
                requireApi(
                    message.s("role") == if (index % 2 == 0) "user" else "assistant",
                    "问答顺序不正确",
                )
                if (index % 2 == 1)
                    requireApi(
                        message.s("sceneId") == messages[index - 1].s("sceneId"),
                        "同一轮问答必须关联同一页面",
                    )
            }
        }
        return value
    }
}
