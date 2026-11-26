package dev.forge

import dev.forge.context.KnowledgeContract
import dev.forge.infrastructure.*
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class ContractOwnershipTest {
    @Test
    fun `API owns the schema and OpenAPI documents from one versioned resource set`() {
        val schemas =
            parse(
                javaClass
                    .getResourceAsStream("/contracts/schemas.json")!!
                    .bufferedReader()
                    .readText()
            )
        val spec =
            parse(
                javaClass
                    .getResourceAsStream("/contracts/openapi.json")!!
                    .bufferedReader()
                    .readText()
            )
        schemas.fields().forEach { (name, schema) ->
            assertEquals(
                schema.copyObject().also { it.remove("\$schema") },
                spec.path("components").path("schemas").path(name),
                name,
            )
        }
    }

    @Test
    fun `knowledge consumer snapshot validates requests without Python runtime`() {
        val contract = KnowledgeContract()
        contract.check(
            "Ingest",
            obj(
                "request_id" to uid(),
                "project_id" to uid(),
                "document_id" to uid(),
                "filename" to "lesson.md",
                "media_type" to "text/markdown",
                "content_base64" to "aGVsbG8=",
            ),
        )
        assertThrows(ApiError::class.java) { contract.check("JobView", obj("id" to uid())) }
    }
}
