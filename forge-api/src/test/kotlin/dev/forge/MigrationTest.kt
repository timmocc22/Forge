package dev.forge

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.node.ObjectNode
import dev.forge.context.*
import dev.forge.execution.*
import dev.forge.generation.*
import dev.forge.infrastructure.*
import dev.forge.projects.*
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.*
import org.junit.jupiter.api.*
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.io.TempDir
import org.springframework.boot.DefaultApplicationArguments
import org.springframework.mock.env.MockEnvironment

class MigrationTest {
    @TempDir lateinit var directory: Path
    private lateinit var config: ForgeConfig
    private lateinit var store: ProjectStore
    private lateinit var runtime: TaskRuntime
    private lateinit var gateway: FixtureGateway
    private lateinit var projects: ProjectService
    private lateinit var conversations: ConversationService
    private val contracts = Contracts()

    @BeforeEach
    fun setup() {
        config = ForgeConfig(MockEnvironment().withProperty("DATA_DIR", directory.toString()))
        store = ProjectStore(config, contracts)
        runtime = TaskRuntime(config)
        gateway = FixtureGateway()
        projects = ProjectService(store, gateway, runtime, contracts)
        conversations =
            ConversationService(store, gateway, runtime, contracts, KnowledgeClient(config))
    }

    @AfterEach
    fun stop() {
        runtime.close()
    }

    private fun create(imported: Boolean = false) =
        projects.create(
            obj(
                "requestId" to uid(),
                "brief" to "数学分数的意义",
                "sceneCount" to 2,
                "sourceHtml" to
                    if (imported) "<!doctype html><html><body><h1>原始标题</h1></body></html>"
                    else null,
            )
        )

    private fun run(p: JsonNode, action: String): ObjectNode {
        projects.start(
            p.s("id"),
            obj("requestId" to uid(), "expectedRevision" to p.i("revision"), "action" to action),
        )
        repeat(200) {
            val current = projects.get(p.s("id"))
            if (current.path("run").s("status") != "running") return current
            Thread.sleep(10)
        }
        throw AssertionError("Task did not finish")
    }

    @Test
    fun `storyboard expansion saves page count survives reload and undoes as one edit`() {
        val p = run(create(), "plan")
        gateway.restructure = true
        val answer =
            conversations.ask(
                p.s("id"),
                obj(
                    "requestId" to uid(),
                    "expectedRevision" to p.i("revision"),
                    "sceneId" to p.o("content").a("scenes")[0].s("id"),
                    "question" to "扩充分镜",
                    "allowEdits" to true,
                    "modelSelection" to obj("provider" to "openai", "model" to "fixture"),
                ),
            )
        val saved = answer.o("project")
        assertEquals(3, saved.i("sceneCount"))
        assertEquals(p.o("content").a("scenes")[0], saved.o("content").a("scenes")[0])
        val inserted = saved.o("content").a("scenes")[2]
        assertTrue(inserted.s("html").isEmpty())
        assertFalse(inserted.b("locked"))
        val reloaded = ProjectStore(config, contracts).get(p.s("id"))
        assertEquals(saved.path("content"), reloaded.path("project").path("content"))
        assertEquals(2, reloaded.path("conversation").a("messages").size())
        val undone =
            projects.undo(
                p.s("id"),
                obj(
                    "expectedRevision" to saved.i("revision"),
                    "operationId" to uid(),
                ),
            )
        assertEquals(p.path("content"), undone.path("content"))
        assertEquals(2, undone.i("sceneCount"))
    }

    @Test
    fun `failed final answer rolls back storyboard structure changes`() {
        val p = run(create(), "plan")
        gateway.restructure = true
        gateway.failAfterEdit = true
        assertThrows(ApiError::class.java) {
            conversations.ask(
                p.s("id"),
                obj(
                    "requestId" to uid(),
                    "expectedRevision" to p.i("revision"),
                    "sceneId" to p.o("content").a("scenes")[0].s("id"),
                    "question" to "扩充分镜",
                    "allowEdits" to true,
                    "modelSelection" to obj("provider" to "openai", "model" to "fixture"),
                ),
            )
        }
        assertEquals(p.path("content"), projects.get(p.s("id")).path("content"))
        assertTrue(conversations.get(p.s("id")).a("messages").isEmpty)
    }

    @Test
    fun `storyboard tools reorder remove and retain generated HTML`() {
        val p = run(create(), "plan")
        val draft = p.copyObject()
        (draft.o("content").a("scenes")[0] as ObjectNode).v(
            "html",
            "<!doctype html><html><body>保留</body></html>",
        )
        val original = draft.o("content").a("scenes").toList()
        val tools = SceneTools(draft, true, obj(), Control(p.s("id"), "test"), gateway, contracts)
        var result =
            tools.execute(
                "update_storyboard",
                obj(
                        "expectedRevision" to draft.i("revision"),
                        "scenes" to original.reversed().map(::storyboardItem),
                    )
                    .toString(),
            )
        assertFalse(result.has("error"), result.toString())
        assertEquals(original.reversed(), draft.o("content").a("scenes").toList())
        result =
            tools.execute(
                "update_storyboard",
                obj(
                        "expectedRevision" to draft.i("revision"),
                        "scenes" to listOf(storyboardItem(original[0])),
                    )
                    .toString(),
            )
        assertFalse(result.has("error"), result.toString())
        assertEquals(original[0], draft.o("content").a("scenes")[0])
    }

    @Test
    fun `invalid storyboard changes preserve draft including locks and built pages`() {
        val p = run(create(), "plan")
        val original = p.o("content").a("scenes").map(::storyboardItem)
        val invalid =
            listOf(
                obj("expectedRevision" to p.i("revision") - 1, "scenes" to original),
                obj(
                    "expectedRevision" to p.i("revision"),
                    "scenes" to listOf(original[0], original[0]),
                ),
                obj("expectedRevision" to p.i("revision"), "scenes" to emptyList<Any>()),
                obj("expectedRevision" to p.i("revision"), "scenes" to List(13) { original[0] }),
                obj(
                    "expectedRevision" to p.i("revision"),
                    "scenes" to listOf(original[0].copyObject().v("sceneId", uid())),
                ),
            )
        for (args in invalid) {
            val draft = p.copyObject()
            val tools =
                SceneTools(draft, true, obj(), Control(p.s("id"), "test"), gateway, contracts)
            assertTrue(tools.execute("update_storyboard", args.toString()).has("error"))
            assertEquals(p, draft)
            assertFalse(tools.changed)
        }
        val draft = p.copyObject()
        (draft.o("content").a("scenes")[0] as ObjectNode).v("locked", true)
        val locked = draft.copyObject()
        val tools = SceneTools(draft, true, obj(), Control(p.s("id"), "test"), gateway, contracts)
        assertTrue(
            tools
                .execute(
                    "update_storyboard",
                    obj(
                            "expectedRevision" to draft.i("revision"),
                            "scenes" to original.reversed(),
                        )
                        .toString(),
                )
                .has("error")
        )
        assertEquals(locked, draft)
        val readOnly =
            SceneTools(draft, false, obj(), Control(p.s("id"), "test"), gateway, contracts)
        assertFalse(readOnly.definitions().any { it.s("name") == "update_storyboard" })
        assertTrue(
            readOnly
                .execute(
                    "update_storyboard",
                    obj(
                            "expectedRevision" to draft.i("revision"),
                            "scenes" to original,
                        )
                        .toString(),
                )
                .has("error")
        )
        assertEquals(locked, draft)
    }

    @Test
    fun `structural merge rejects concurrent manual edits and removal of locked pages`() {
        val p = run(create(), "plan")
        val draft = p.copyObject()
        draft.o("content").a("scenes").remove(1)
        assertEquals(1, mergeDraft(p, p, draft).a("scenes").size())
        val current = p.copyObject()
        (current.o("content").a("scenes")[0] as ObjectNode).v("title", "手动修改")
        assertEquals(
            409,
            assertThrows(ApiError::class.java) { mergeDraft(current, p, draft) }.status,
        )
        (p.o("content").a("scenes")[1] as ObjectNode).v("locked", true)
        assertEquals(409, assertThrows(ApiError::class.java) { mergeDraft(p, p, draft) }.status)
    }

    @Test
    fun `create defaults and request idempotency preserve protocol`() {
        val request = obj("requestId" to uid(), "brief" to "主题")
        val a = projects.create(request)
        assertEquals(a.s("id"), projects.create(request).s("id"))
        contracts.check("htmlProjectSchema", a)
        assertEquals(5, a.i("sceneCount"))
    }

    @Test
    fun `plan build save conflict and undo roundtrip`() {
        var p = create()
        p = run(p, "plan")
        assertEquals("succeeded", p.path("run").s("status"))
        assertEquals(2, p.o("content").a("scenes").size())
        p = run(p, "build")
        assertEquals("succeeded", p.path("run").s("status"))
        assertTrue(p.o("content").a("scenes").all { it.s("html").contains("</html>") })
        val original = p.o("content").copyObject()
        val content = original.copyObject().v("title", "修改后的标题")
        val operation = uid()
        val saved =
            projects.save(
                p.s("id"),
                obj(
                    "expectedRevision" to p.i("revision"),
                    "operationId" to operation,
                    "content" to content,
                ),
            )
        assertEquals(
            saved.i("revision"),
            projects
                .save(
                    p.s("id"),
                    obj(
                        "expectedRevision" to p.i("revision"),
                        "operationId" to operation,
                        "content" to content,
                    ),
                )
                .i("revision"),
        )
        assertEquals(
            409,
            assertThrows(ApiError::class.java) {
                    projects.save(
                        p.s("id"),
                        obj(
                            "expectedRevision" to p.i("revision"),
                            "operationId" to uid(),
                            "content" to original,
                        ),
                    )
                }
                .status,
        )
        val undone =
            projects.undo(
                p.s("id"),
                obj("expectedRevision" to saved.i("revision"), "operationId" to uid()),
            )
        assertEquals(original, undone.path("content"))
    }

    @Test
    fun `database persists records and immutable objects across instances`() {
        val p = create(true)
        val other = ProjectStore(config, contracts)
        assertEquals(p, other.get(p.s("id")).path("project"))
        assertTrue(Files.list(directory.resolve("objects")).use { it.count() > 0 })
    }

    @Test
    fun `concurrent saves accept only one version`() {
        val p = create(true)
        val threads = Executors.newFixedThreadPool(2)
        try {
            val attempts =
                (1..2).map { i ->
                    threads.submit<Int> {
                        try {
                            projects.save(
                                p.s("id"),
                                obj(
                                    "expectedRevision" to 0,
                                    "operationId" to uid(),
                                    "content" to
                                        p.o("content").copyObject().v("title", "writer $i"),
                                ),
                            )
                            200
                        } catch (e: ApiError) {
                            e.status
                        }
                    }
                }
            assertEquals(listOf(200, 409), attempts.map { it.get() }.sorted())
        } finally {
            threads.shutdownNow()
        }
    }

    @Test
    fun `different page merge preserves manual edits while stale same page conflicts`() {
        val p = run(create(), "plan")
        val a = p.copyObject()
        val d = p.copyObject()
        (a.o("content").a("scenes")[0] as ObjectNode).v("title", "手动修改")
        (d.o("content").a("scenes")[1] as ObjectNode).v("title", "AI 修改")
        val merged = mergeDraft(a, p, d)
        assertEquals("手动修改", merged.a("scenes")[0].s("title"))
        assertEquals("AI 修改", merged.a("scenes")[1].s("title"))
        (d.o("content").a("scenes")[0] as ObjectNode).v("title", "冲突")
        assertEquals(409, assertThrows(ApiError::class.java) { mergeDraft(a, p, d) }.status)
    }

    @Test
    fun `conversation persists complete turns and retries do not duplicate them`() {
        val p = create(true)
        val input =
            obj(
                "requestId" to uid(),
                "expectedRevision" to p.i("revision"),
                "sceneId" to p.o("content").a("scenes")[0].s("id"),
                "question" to "解释当前页",
                "allowEdits" to false,
            )
        val first = conversations.ask(p.s("id"), input)
        contracts.check("conversationSchema", first.path("conversation"))
        assertEquals(2, first.path("conversation").a("messages").size())
        assertEquals(first.s("answer"), conversations.ask(p.s("id"), input).s("answer"))
        assertEquals(2, conversations.get(p.s("id")).a("messages").size())
    }

    @Test
    fun `ask only tools cannot mutate page`() {
        val p = create(true)
        val c = Control(p.s("id"), "test")
        val tools =
            SceneTools(
                p.copyObject(),
                false,
                obj("provider" to "openai", "model" to "fixture"),
                c,
                gateway,
                contracts,
            )
        val result =
            tools.execute(
                "revise_scene",
                obj(
                        "sceneId" to p.o("content").a("scenes")[0].s("id"),
                        "expectedRevision" to 0,
                        "instruction" to "修改",
                    )
                    .toString(),
            )
        assertTrue(result.has("error"))
        assertFalse(tools.changed)
    }

    @Test
    fun `failed final answer rolls back all tool edits`() {
        val p = create(true)
        store.update(p.s("id")) {
            it.o("project").v("modelSelection", obj("provider" to "openai", "model" to "fixture"))
        }
        gateway.failAfterEdit = true
        val scene = p.o("content").a("scenes")[0]
        assertThrows(ApiError::class.java) {
            conversations.ask(
                p.s("id"),
                obj(
                    "requestId" to uid(),
                    "expectedRevision" to 0,
                    "sceneId" to scene.s("id"),
                    "question" to "修改标题",
                    "allowEdits" to true,
                ),
            )
        }
        assertEquals(scene, projects.get(p.s("id")).o("content").a("scenes")[0])
        assertTrue(conversations.get(p.s("id")).a("messages").isEmpty)
    }

    @Test
    fun `successful tool edits commit atomically and one undo restores content`() {
        val p = create(true)
        store.update(p.s("id")) {
            it.o("project").v("modelSelection", obj("provider" to "openai", "model" to "fixture"))
        }
        val scene = p.o("content").a("scenes")[0]
        val answer =
            conversations.ask(
                p.s("id"),
                obj(
                    "requestId" to uid(),
                    "expectedRevision" to 0,
                    "sceneId" to scene.s("id"),
                    "question" to "修改标题",
                    "allowEdits" to true,
                ),
            )
        val saved = answer.o("project")
        assertEquals("工具修改后的标题", saved.o("content").a("scenes")[0].s("title"))
        val undone =
            projects.undo(
                p.s("id"),
                obj("expectedRevision" to saved.i("revision"), "operationId" to uid()),
            )
        assertEquals(p.path("content"), undone.path("content"))
    }

    @Test
    fun `resume commits a completed checkpoint without repeating model calls`() {
        val project = create(true)
        val id = project.s("id")
        val model = obj("provider" to "openai", "model" to "fixture")
        val scene = project.o("content").a("scenes")[0]
        val input =
            obj(
                "requestId" to uid(),
                "expectedRevision" to 0,
                "sceneId" to scene.s("id"),
                "question" to "优化本页",
                "allowEdits" to true,
                "multiStep" to true,
            )
        val draft = project.o("content").copyObject()
        (draft.a("scenes")[0] as ObjectNode).v("title", "检查点中的已完成修改")
        val fingerprint =
            sha(
                obj(
                        "input" to input.copyObject().also { it.remove("expectedRevision") },
                        "model" to model,
                    )
                    .toString()
                    .toByteArray()
            )
        store.update(id, false) { record ->
            record.o("project").v("modelSelection", model)
            record.v(
                "checkpoint",
                obj(
                    "requestId" to input.s("requestId"),
                    "fingerprint" to fingerprint,
                    "baseRevision" to 0,
                    "draftRevision" to 1,
                    "content" to draft,
                    "task" to
                        obj(
                            "phase" to "checking",
                            "steps" to
                                listOf(
                                    obj(
                                        "sceneId" to scene.s("id"),
                                        "title" to scene.s("title"),
                                        "instruction" to "优化本页",
                                        "status" to "succeeded",
                                    )
                                ),
                        ),
                ),
            )
        }
        val result = conversations.ask(id, input)
        assertEquals("检查点中的已完成修改", result.o("project").o("content").a("scenes")[0].s("title"))
        assertEquals(0, gateway.calls)
        assertEquals(1, result.o("project").i("undoDepth"))
    }

    @Test
    fun `restart interrupts task and command without replaying model calls`() {
        val p = create(true)
        store.update(p.s("id")) { r ->
            r.o("project")
                .v(
                    "run",
                    obj(
                        "id" to uid(),
                        "requestId" to uid(),
                        "action" to "build",
                        "status" to "running",
                        "completed" to 0,
                        "total" to 1,
                        "message" to "running",
                        "modelSelection" to p.path("modelSelection"),
                        "startedAt" to now(),
                    ),
                )
            r.v(
                "commands",
                listOf(
                    obj(
                        "id" to uid(),
                        "projectId" to p.s("id"),
                        "question" to "继续",
                        "mode" to "revise",
                        "kind" to "message",
                        "append" to false,
                        "timing" to "after",
                        "createdAt" to now(),
                        "status" to "queued",
                        "attempt" to 0,
                        "error" to "",
                    )
                ),
            )
        }
        ForgeApplication().recover(store, config, runtime).run(DefaultApplicationArguments())
        assertEquals("failed", projects.get(p.s("id")).path("run").s("status"))
        assertEquals("failed", store.get(p.s("id")).a("commands")[0].s("status"))
        assertEquals(0, gateway.calls)
    }

    @Test
    fun `legacy v2 import verifies objects and leaves source untouched`() {
        val old = directory.resolve("legacy")
        Files.createDirectories(old.resolve("objects"))
        val p = create(true)
        val r = store.get(p.s("id"))
        val content = p.path("content").toString().toByteArray()
        val hash = sha(content)
        Files.write(old.resolve("objects/$hash.json"), content)
        val manifest = r.copyObject()
        manifest.o("project").remove("content")
        manifest.v("schemaVersion", 2).v("content", hash)
        manifest.remove("_storeVersion")
        val path = old.resolve("${p.s("id")}.json")
        Files.writeString(path, manifest.toString())
        val newConfig =
            ForgeConfig(
                MockEnvironment().withProperty("DATA_DIR", directory.resolve("new").toString())
            )
        val imported = ProjectStore(newConfig, contracts)
        assertEquals(1, imported.importLegacy(old).i("imported"))
        assertEquals(p, imported.get(p.s("id")).path("project"))
        assertEquals(manifest.toString(), Files.readString(path))
    }
}

class FixtureGateway : GenerationGateway {
    var failAfterEdit = false
    var restructure = false
    var calls = 0

    override fun resolve(selection: JsonNode?) =
        (selection?.copyObject() ?: obj("provider" to "demo", "model" to "local-sample"))

    override fun catalog() = obj()

    override fun html(selection: JsonNode, input: JsonNode, control: Control) =
        "<!doctype html><html><body>fixture</body></html>"

    override fun complete(
        selection: JsonNode,
        name: String,
        schema: JsonNode,
        instructions: String,
        input: JsonNode,
        control: Control,
        tools: JsonNode?,
        requireTool: Boolean,
        execute: ((String, String) -> JsonNode)?,
    ): JsonNode {
        calls++
        if (name == "forge_revised_scene")
            return input
                .path("scene")
                .copyObject()
                .also { it.remove(listOf("id", "locked")) }
                .v("title", "工具修改后的标题")
                .v("html", "<!doctype html><html><body><h1>工具修改后的标题</h1></body></html>")
        if (name == "forge_scene_answer") {
            if (restructure) {
                val project = input.path("project")
                val pages = project.path("content").a("scenes").map(::storyboardItem)
                val added =
                    pages[0].copyObject().also { it.putNull("sceneId") }.v("title", "新增的详细讲解")
                val result =
                    execute!!(
                        "update_storyboard",
                        obj(
                                "expectedRevision" to project.i("revision"),
                                "scenes" to pages + listOf(added),
                            )
                            .toString(),
                    )
                requireApi(!result.has("error"), result.s("message"), 503)
                if (failAfterEdit) throw ApiError(503, "fixture failure")
                return obj("answer" to "分镜已扩充", "taskStatus" to "completed")
            }
            val scene = input.path("project").path("content").a("scenes")[0]
            execute!!("read_scene", obj("sceneId" to scene.s("id")).toString())
            val result =
                execute(
                    "revise_scene",
                    obj(
                            "sceneId" to scene.s("id"),
                            "expectedRevision" to input.path("project").i("revision"),
                            "instruction" to "修改标题",
                        )
                        .toString(),
                )
            requireApi(!result.has("error"), result.s("message"), 503)
            if (failAfterEdit) throw ApiError(503, "fixture failure")
            return obj("answer" to "标题已修改", "taskStatus" to "completed")
        }
        error("Unexpected fixture call $name")
    }
}

private fun storyboardItem(scene: JsonNode) =
    scene.copyObject().also {
        it.remove(listOf("id", "html", "locked"))
        it.v("sceneId", scene.s("id"))
    }
