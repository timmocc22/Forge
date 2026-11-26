package dev.forge.context

import com.fasterxml.jackson.databind.JsonNode
import com.networknt.schema.JsonSchemaFactory
import com.networknt.schema.SpecVersion
import dev.forge.infrastructure.*

/** Consumer-owned snapshot: building the API never imports Python source or starts Python. */
class KnowledgeContract {
    private val specification =
        parse(
            javaClass
                .getResourceAsStream("/knowledge-contract/openapi.v1.json")!!
                .bufferedReader()
                .use { it.readText() }
        )
    private val factory = JsonSchemaFactory.getInstance(SpecVersion.VersionFlag.V202012)

    fun check(name: String, value: JsonNode) {
        val schema =
            obj(
                "\$ref" to "#/components/schemas/$name",
                "components" to specification.path("components"),
            )
        val errors = factory.getSchema(schema).validate(value)
        requireApi(errors.isEmpty(), "知识库接口数据与约定版本不兼容", 503)
    }
}
