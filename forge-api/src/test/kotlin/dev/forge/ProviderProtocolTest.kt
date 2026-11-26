package dev.forge

import com.sun.net.httpserver.HttpServer
import dev.forge.execution.Control
import dev.forge.generation.ModelGateway
import dev.forge.infrastructure.*
import java.net.InetSocketAddress
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.mock.env.MockEnvironment

class ProviderProtocolTest {
    @Test
    fun `Zhipu final correction uses JSON mode without replaying tools`() {
        fixture(
            provider = "zhipu",
            handle = { turn, input ->
                when (turn) {
                    0 -> {
                        assertTrue(input.has("tools"))
                        assertFalse(input.has("text"))
                        200 to
                            obj(
                                    "status" to "completed",
                                    "output" to
                                        listOf(
                                            obj(
                                                "type" to "function_call",
                                                "call_id" to "read-1",
                                                "name" to "read_scene",
                                                "arguments" to "{}",
                                            )
                                        ),
                                )
                                .toString()
                    }
                    1 -> 200 to messageResponse("Finished reading the page.")
                    else -> {
                        assertEquals(2, turn)
                        assertFalse(input.has("tools"))
                        assertFalse(input.has("tool_choice"))
                        assertEquals("json_object", input.path("text").path("format").s("type"))
                        200 to messageResponse("""{"answer":"已读取","taskStatus":"completed"}""")
                    }
                }
            },
        ) { gateway ->
            var executions = 0
            val result =
                gateway.complete(
                    obj("provider" to "zhipu", "model" to "fixture"),
                    "test",
                    parse("""{"type":"object","required":["answer","taskStatus"]}"""),
                    "Read the page",
                    obj(),
                    Control(uid(), "test"),
                    arr(),
                    true,
                ) { _, _ ->
                    executions++
                    obj()
                }
            assertEquals(1, executions)
            assertEquals("已读取", result.s("answer"))
        }
    }

    @Test
    fun `page workflows can exceed twelve calls and still produce a final answer`() {
        fixture(
            handle = { turn, _ ->
                if (turn < 15) {
                    200 to
                        obj(
                                "status" to "completed",
                                "output" to
                                    listOf(
                                        obj(
                                            "type" to "function_call",
                                            "call_id" to "call-$turn",
                                            "name" to "read_scene",
                                            "arguments" to "{}",
                                        )
                                    ),
                            )
                            .toString()
                } else {
                    assertEquals(15, turn)
                    200 to messageResponse("""{"answer":"完成"}""")
                }
            }
        ) { gateway ->
            var executions = 0
            val answer =
                gateway.complete(
                    obj("provider" to "openai", "model" to "fixture"),
                    "test",
                    obj("type" to "object"),
                    "Inspect pages",
                    obj(),
                    Control(uid(), "test"),
                    arr(),
                    true,
                ) { _, _ ->
                    executions++
                    obj()
                }
            assertEquals(15, executions)
            assertEquals("完成", answer.s("answer"))
        }
    }

    @Test
    fun `oversized tool batch is rejected before execution`() {
        fixture(
            handle = { _, _ ->
                200 to
                    obj(
                            "status" to "completed",
                            "output" to
                                List(41) { index ->
                                    obj(
                                        "type" to "function_call",
                                        "call_id" to "call-$index",
                                        "name" to "revise_scene",
                                        "arguments" to "{}",
                                    )
                                },
                        )
                        .toString()
            }
        ) { gateway ->
            var executions = 0
            val error =
                assertThrows(ApiError::class.java) {
                    gateway.complete(
                        obj("provider" to "openai", "model" to "fixture"),
                        "test",
                        obj("type" to "object"),
                        "Inspect pages",
                        obj(),
                        Control(uid(), "test"),
                        arr(),
                        false,
                    ) { _, _ ->
                        executions++
                        obj()
                    }
                }
            assertEquals(0, executions)
            assertTrue(error.message.contains("调用上限"))
        }
    }

    @Test
    fun `duplicate tool batch is rejected before any edit executes`() {
        fixture(
            handle = { _, _ ->
                200 to
                    obj(
                            "status" to "completed",
                            "output" to
                                List(2) {
                                    obj(
                                        "type" to "function_call",
                                        "call_id" to "duplicate",
                                        "name" to "revise_scene",
                                        "arguments" to "{}",
                                    )
                                },
                        )
                        .toString()
            }
        ) { gateway ->
            var executions = 0
            val error =
                assertThrows(ApiError::class.java) {
                    gateway.complete(
                        obj("provider" to "openai", "model" to "fixture"),
                        "test",
                        obj("type" to "object"),
                        "Revise pages",
                        obj(),
                        Control(uid(), "test"),
                        arr(),
                        false,
                    ) { _, _ ->
                        executions++
                        obj()
                    }
                }
            assertEquals(0, executions)
            assertTrue(error.message.contains("重复的工具调用标识"))
        }
    }

    private fun messageResponse(text: String): String =
        obj(
                "status" to "completed",
                "output" to
                    listOf(
                        obj(
                            "type" to "message",
                            "role" to "assistant",
                            "content" to listOf(obj("type" to "output_text", "text" to text)),
                        )
                    ),
            )
            .toString()

    @Test
    fun `schema echo is corrected with validation feedback before returning data`() {
        val schema = Contracts().schema("htmlCreativePlanningSchema")
        fixture(
            provider = "zhipu",
            handle = { turn, input ->
                assertTrue(input.s("instructions").contains("not the response itself"))
                assertTrue(input.s("instructions").contains("<output_schema>"))
                if (turn == 0) {
                    200 to messageResponse(schema.toString())
                } else {
                    assertEquals(1, turn)
                    assertEquals(3, input.a("input").size())
                    assertTrue(input.a("input").last().s("content").contains("Validation:"))
                    200 to messageResponse("""{"question":"需要面向哪类观众？","options":[],"plan":null}""")
                }
            },
        ) { gateway ->
            val result =
                gateway.complete(
                    obj("provider" to "zhipu", "model" to "fixture"),
                    "forge_creative_planning",
                    schema,
                    "Plan a presentation",
                    obj("brief" to "星际穿越讲解"),
                    Control(uid(), "test"),
                )
            assertEquals("需要面向哪类观众？", result.s("question"))
            assertTrue(result.path("plan").isNull)
        }
    }

    @Test
    fun `invalid JSON correction is bounded and never returns an invalid schema instance`() {
        fixture(
            provider = "deepseek",
            handle = { turn, _ ->
                assertTrue(turn <= 1)
                200 to messageResponse(if (turn == 0) "not JSON" else "{}")
            },
        ) { gateway ->
            val error =
                assertThrows(ApiError::class.java) {
                    gateway.complete(
                        obj("provider" to "deepseek", "model" to "fixture"),
                        "forge_creative_planning",
                        Contracts().schema("htmlCreativePlanningSchema"),
                        "Plan a presentation",
                        obj(),
                        Control(uid(), "test"),
                    )
                }
            assertEquals(503, error.status)
            assertTrue(error.message.contains("模型返回的数据不符合所需结构"))
        }
    }

    private fun fixture(
        provider: String = "openai",
        handle: (Int, com.fasterxml.jackson.databind.JsonNode) -> Pair<Int, String>,
        test: (ModelGateway) -> Unit,
    ) {
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        var turns = 0
        server.createContext("/v1/responses") { exchange ->
            val input = parse(exchange.requestBody.bufferedReader().readText())
            val (status, body) = handle(turns++, input)
            val bytes = body.toByteArray()
            exchange.responseHeaders.set("Content-Type", "application/json")
            exchange.sendResponseHeaders(status, bytes.size.toLong())
            exchange.responseBody.use { it.write(bytes) }
        }
        server.start()
        val env =
            MockEnvironment()
                .withProperty("${provider.uppercase()}_API_KEY", "fixture-key")
                .withProperty(
                    "${provider.uppercase()}_BASE_URL",
                    "http://127.0.0.1:${server.address.port}/v1",
                )
                .withProperty("${provider.uppercase()}_TEXT_MODEL", "fixture")
                .withProperty("ALLOW_LOCAL_MODEL_HTTP", "true")
        val gateway = ModelGateway(ForgeConfig(env))
        try {
            test(gateway)
        } finally {
            gateway.close()
            server.stop(0)
        }
    }

    @Test
    fun `tool replay preserves reasoning and releases required choice after native call`() {
        fixture(
            handle = { turn, input ->
                if (turn == 0) {
                    assertEquals("required", input.s("tool_choice"))
                    200 to
                        obj(
                                "status" to "completed",
                                "output" to
                                    listOf(
                                        obj(
                                            "type" to "reasoning",
                                            "id" to "r1",
                                            "encrypted_content" to "opaque-fixture",
                                        ),
                                        obj(
                                            "type" to "function_call",
                                            "call_id" to "call-1",
                                            "name" to "list_scenes",
                                            "arguments" to "{}",
                                        ),
                                    ),
                            )
                            .toString()
                } else {
                    assertFalse(input.has("tool_choice"))
                    assertTrue(
                        input.a("input").any {
                            it.s("type") == "reasoning" &&
                                it.s("encrypted_content") == "opaque-fixture"
                        }
                    )
                    assertTrue(
                        input.a("input").any {
                            it.s("type") == "function_call_output" && it.s("call_id") == "call-1"
                        }
                    )
                    200 to
                        obj(
                                "status" to "completed",
                                "output" to
                                    listOf(
                                        obj(
                                            "type" to "message",
                                            "content" to
                                                obj(
                                                    "type" to "output_text",
                                                    "text" to "{\"answer\":\"完成\"}",
                                                ),
                                        )
                                    ),
                            )
                            .toString()
                }
            }
        ) { gateway ->
            var executions = 0
            val answer =
                gateway.complete(
                    obj("provider" to "openai", "model" to "fixture"),
                    "test",
                    obj("type" to "object"),
                    "Inspect pages",
                    obj("question" to "读取页面"),
                    Control(uid(), "test"),
                    arr(
                        listOf(
                            obj(
                                "type" to "function",
                                "name" to "list_scenes",
                                "parameters" to obj("type" to "object"),
                            )
                        )
                    ),
                    true,
                ) { name, args ->
                    assertEquals("list_scenes", name)
                    assertEquals("{}", args)
                    executions++
                    obj("revision" to 0)
                }
            assertEquals("完成", answer.s("answer"))
            assertEquals(1, executions)
        }
    }

    @Test
    fun `Zhipu tool requests omit JSON mode and retain reasoning effort`() {
        fixture(
            provider = "zhipu",
            handle = { _, input ->
                assertFalse(input.has("text"))
                assertEquals("high", input.path("reasoning").s("effort"))
                200 to
                    obj(
                            "status" to "completed",
                            "output" to
                                listOf(
                                    obj(
                                        "type" to "message",
                                        "content" to
                                            listOf(
                                                obj(
                                                    "type" to "output_text",
                                                    "text" to "{\"answer\":\"建议\"}",
                                                )
                                            ),
                                    )
                                ),
                        )
                        .toString()
            },
        ) { gateway ->
            val answer =
                gateway.complete(
                    obj("provider" to "zhipu", "model" to "fixture"),
                    "test",
                    obj("type" to "object"),
                    "Return JSON",
                    obj(),
                    Control(uid(), "test"),
                    arr(),
                    false,
                ) { _, _ ->
                    obj()
                }
            assertEquals("建议", answer.s("answer"))
        }
    }

    @Test
    fun `upstream response details never enter public errors`() {
        fixture(
            handle = { _, _ -> 401 to "{\"error\":{\"message\":\"fixture-private-message\"}}" }
        ) { gateway ->
            val error =
                assertThrows(ApiError::class.java) {
                    gateway.html(
                        obj("provider" to "openai", "model" to "fixture"),
                        obj(),
                        Control(uid(), "test"),
                    )
                }
            assertEquals(503, error.status)
            assertFalse(error.message.contains("fixture-private-message"))
        }
    }
}
