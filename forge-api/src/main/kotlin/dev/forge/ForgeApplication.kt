package dev.forge

import dev.forge.infrastructure.*
import java.nio.file.Path
import org.springframework.boot.ApplicationRunner
import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.runApplication
import org.springframework.context.annotation.Bean
import org.springframework.scheduling.annotation.EnableScheduling

@EnableScheduling
@SpringBootApplication(
    excludeName = ["org.springframework.boot.jdbc.autoconfigure.DataSourceAutoConfiguration"]
)
class ForgeApplication {
    @Bean
    fun recover(
        store: ProjectStore,
        config: ForgeConfig,
        runtime: dev.forge.execution.TaskRuntime,
    ) = ApplicationRunner {
        config
            .get("IMPORT_LEGACY_DIR")
            .takeIf { it.isNotBlank() }
            ?.let { store.importLegacy(Path.of(it)) }
        store.all().forEach { r ->
            store.update(r.o("project").s("id"), false) { record ->
                val p = record.o("project")
                (p.get("run") as? com.fasterxml.jackson.databind.node.ObjectNode)
                    ?.takeIf { it.s("status") == "running" }
                    ?.let {
                        it.v("status", "failed").v("message", "服务已重启，已完成页面保留，请手动重试。")
                        p.v("revision", p.i("revision") + 1)
                    }
                (record.path("conversation").get("pending")
                        as? com.fasterxml.jackson.databind.node.ObjectNode)
                    ?.takeIf { it.s("status") == "running" }
                    ?.v("status", "interrupted")
                    ?.v("error", "服务已重启，可继续回复")
                record.a("commands").forEach {
                    (it as com.fasterxml.jackson.databind.node.ObjectNode)
                        .v("status", "failed")
                        .v("error", "服务已重启，请确认后继续此任务")
                }
            }
        }
        runtime.ready.set(true)
    }
}

fun main(args: Array<String>) {
    runApplication<ForgeApplication>(*args)
}
