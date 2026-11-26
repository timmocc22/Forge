package dev.forge.execution

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.node.ObjectNode
import dev.forge.infrastructure.*
import dev.forge.projects.*
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component

@Component
class ProjectCommands(
    private val store: ProjectStore,
    private val projects: ProjectService,
    private val conversations: ConversationService,
    private val runtime: TaskRuntime,
) {
    private val workers = ConcurrentHashMap.newKeySet<String>()

    fun list(id: String) = store.get(id).a("commands")

    fun enqueue(id: String, input: JsonNode): JsonNode {
        requireApi(input.s("projectId") == id, "任务必须属于当前项目", 409)
        store.update(id, false) { currentRecord ->
            val commands = currentRecord.a("commands")
            val existing = commands.find { it.s("id") == input.s("id") }
            if (existing != null) {
                val identityFields = listOf("question", "sceneId", "mode", "multiStep", "task")
                for (field in identityFields) {
                    requireApi(existing.get(field) == input.get(field), "任务标识已被其他要求使用", 409)
                }
            } else if (
                !store.hasOperation(currentRecord, input.s("id")) &&
                    currentRecord.path("conversation").a("messages").none {
                        it.s("id") == input.s("id")
                    }
            ) {
                requireApi(commands.size() < 20, "待处理任务已达 20 条，请先处理或移除", 409)
                commands.add(
                    input
                        .copyObject()
                        .v("createdAt", now())
                        .v("status", "queued")
                        .v("error", "")
                        .v("attempt", 0)
                )
                currentRecord.v("commands", commands)
            }
        }
        kick(id)
        return list(id)
    }

    fun change(id: String, commandId: String, action: String): JsonNode {
        requireApi(action in listOf("remove", "retry", "interrupt"), "未知任务操作")
        if (action == "interrupt") {
            projects.cancel(id)
            conversations.stop(id)
        }
        store.update(id, false) { currentRecord ->
            val queue = currentRecord.a("commands")
            val command =
                queue.find { it.s("id") == commandId } as? ObjectNode
                    ?: throw ApiError(404, "任务不存在")
            requireApi(command.s("status") != "running", "请先停止正在执行的任务", 409)
            if (action == "remove")
                currentRecord.v("commands", queue.filter { it.s("id") != commandId })
            else {
                command.v("status", "queued").v("error", "").v("attempt", command.i("attempt") + 1)
                if (action == "interrupt") {
                    command.v("timing", "interrupt").v("interrupted", true)
                    currentRecord.v(
                        "commands",
                        listOf(command) +
                            queue.filter { it.s("id") != commandId && it.s("status") != "running" },
                    )
                }
            }
        }
        kick(id)
        return list(id)
    }

    fun clear(id: String): JsonNode {
        store.update(id, false) { it.v("commands", arr()) }
        projects.cancel(id)
        conversations.stop(id)
        return list(id)
    }

    @Scheduled(fixedDelay = 250)
    fun dispatch() {
        if (runtime.ready.get() && !runtime.closing.get()) {
            store.pendingIds("commands").forEach { kick(it) }
        }
    }

    fun kick(id: String) {
        if (runtime.closing.get() || !workers.add(id)) return
        runtime.executor.submit {
            try {
                drain(id)
            } finally {
                workers.remove(id)
            }
        }
    }

    private fun drain(id: String) {
        while (!runtime.closing.get()) {
            val record = runCatching { store.get(id) }.getOrNull() ?: return
            val command = record.a("commands").firstOrNull()?.copyObject() ?: return
            if (command.s("status") != "queued") return
            if (runtime.active(id) != null || !runtime.available()) return
            val snapshot = record.o("project")
            if (
                command.s("kind") == "plan" &&
                    command.i("attempt") == 0 &&
                    command.b("append") &&
                    command.path("task").s("action") == "plan" &&
                    !snapshot.has("run")
            )
                return
            var claimed = false
            store.update(id, false) { currentRecord ->
                val first = currentRecord.a("commands").firstOrNull() as? ObjectNode
                if (first?.s("id") == command.s("id") && first.s("status") == "queued") {
                    first.v("status", "running")
                    claimed = true
                }
            }
            if (!claimed) continue
            try {
                execute(id, command)
                store.update(id, false) { currentRecord ->
                    if (currentRecord.a("commands").any { it.s("id") == command.s("id") }) {
                        currentRecord.v(
                            "commands",
                            currentRecord.a("commands").filter { it.s("id") != command.s("id") },
                        )
                        store.operation(currentRecord, command.s("id"))
                    }
                }
            } catch (e: Exception) {
                store.update(id, false) { currentRecord ->
                    (currentRecord.a("commands").find { it.s("id") == command.s("id") }
                            as? ObjectNode)
                        ?.let {
                            if (e is ApiError && e.code == "TASK_CAPACITY") it.v("status", "queued")
                            else
                                it.v("status", "failed")
                                    .v("error", if (e is ApiError) e.message else "任务执行失败，可重试")
                        }
                    Unit
                }
                return
            }
        }
    }

    private fun execute(id: String, command: JsonNode) {
        var project = projects.get(id)
        val needsPlan = project.o("content").a("scenes").isEmpty
        if (
            (command.s("kind") == "plan" || needsPlan) &&
                project.path("run").s("status") != "awaiting_input"
        ) {
            val brief =
                command.get("brief")?.asText()
                    ?: if (command.b("append"))
                        project.o("content").s("brief") + "\n\n补充要求：" + command.s("question")
                    else command.s("question")
            requireApi(brief.length <= 8000, "累计创作要求超过 8000 字，请精简后发送", 409)
            project =
                projects.save(
                    id,
                    obj(
                        "expectedRevision" to project.i("revision"),
                        "operationId" to key(command.s("id"), "prepare"),
                        "content" to project.o("content").copyObject().v("brief", brief),
                    ),
                )
        }
        val action =
            if (needsPlan) "plan"
            else if (project.path("run").s("status") == "awaiting_input")
                project.path("run").s("action")
            else if (
                command.b("interrupted") &&
                    command.path("task").s("action") in listOf("build", "scene")
            )
                command.path("task").s("action")
            else null
        if (action != null) {
            val instruction =
                if (command.has("task"))
                    command.path("task").s("goal") + "\n\n补充要求：" + command.s("question")
                else command.s("question")
            requireApi(instruction.length <= 8000, "累计任务要求超过 8000 字，请精简后发送", 409)
            val run =
                projects.start(
                    id,
                    obj(
                        "expectedRevision" to project.i("revision"),
                        "requestId" to key(command.s("id"), "run:${command.i("attempt")}"),
                        "action" to action,
                        "sceneId" to
                            if (action == "scene")
                                command.path("task").get("sceneId") ?: command.get("sceneId")
                            else null,
                        "instruction" to instruction,
                        "modelSelection" to command.get("modelSelection"),
                    ),
                )
            while (
                !runtime.closing.get() &&
                    projects.get(id).path("run").s("id") == run.path("run").s("id") &&
                    projects.get(id).path("run").s("status") == "running"
            ) Thread.sleep(50)
            val completed = projects.get(id).path("run")
            requireApi(completed.s("status") != "failed", completed.s("message"), 409)
            return
        }
        val target = command.path("task").s("sceneId", command.s("sceneId"))
        val scene =
            project.o("content").a("scenes").find { it.s("id") == target }
                ?: project.o("content").a("scenes").first()
        conversations.ask(
            id,
            obj(
                "expectedRevision" to project.i("revision"),
                "requestId" to command.s("id"),
                "sceneId" to scene.s("id"),
                "question" to command.s("question"),
                "modelSelection" to command.get("modelSelection"),
                "allowEdits" to command.path("task").b("allowEdits", command.s("mode") != "ask"),
                "multiStep" to
                    command
                        .path("task")
                        .b("multiStep", command.s("mode") != "ask" && command.b("multiStep")),
                "continuation" to
                    if (command.has("task"))
                        obj(
                            "action" to command.path("task").s("action"),
                            "goal" to command.path("task").s("goal"),
                            "timing" to command.s("timing"),
                        )
                    else null,
            ),
        )
    }

    private fun key(id: String, purpose: String) =
        UUID.nameUUIDFromBytes("$id:$purpose".toByteArray()).toString()
}
