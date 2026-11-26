package dev.forge.execution

import dev.forge.infrastructure.*
import jakarta.annotation.PreDestroy
import java.util.concurrent.*
import java.util.concurrent.atomic.AtomicBoolean
import org.springframework.stereotype.Component

class Control(val projectId: String, val kind: String, val id: String = uid()) {
    val cancelled = AtomicBoolean(false)
    val deadline = System.nanoTime() + TimeUnit.MINUTES.toNanos(10)

    fun check() {
        if (cancelled.get() || Thread.currentThread().isInterrupted)
            throw ApiError(503, "任务已停止，可继续重试")
        if (System.nanoTime() > deadline) throw ApiError(503, "任务超时，可继续重试")
    }

    fun <T> await(future: CompletableFuture<T>): T {
        try {
            while (true) {
                check()
                try {
                    return future.get(100, TimeUnit.MILLISECONDS)
                } catch (_: TimeoutException) {}
            }
        } catch (e: Exception) {
            future.cancel(true)
            throw e
        }
    }
}

@Component
class TaskRuntime(config: ForgeConfig) {
    val executor: ExecutorService = Executors.newVirtualThreadPerTaskExecutor()
    private val slots = Semaphore(config.capacity, true)
    private val active = ConcurrentHashMap<String, Control>()
    val closing = AtomicBoolean(false)
    val ready = AtomicBoolean(false)

    fun available() = slots.availablePermits() > 0

    fun active(id: String) = active[id]

    fun acquire(id: String, kind: String): Control {
        requireApi(!closing.get(), "服务正在关闭", 503)
        val control = Control(id, kind)
        requireApi(active.putIfAbsent(id, control) == null, "当前项目有任务正在执行，请先停止或等待完成", 409)
        if (!slots.tryAcquire()) {
            active.remove(id, control)
            throw ApiError(409, "当前模型任务较多，请稍后重试", "TASK_CAPACITY")
        }
        return control
    }

    fun release(c: Control) {
        if (active.remove(c.projectId, c)) slots.release()
    }

    fun cancel(id: String, kind: String? = null) {
        active[id]?.takeIf { kind == null || it.kind == kind }?.cancelled?.set(true)
    }

    @PreDestroy
    fun close() {
        closing.set(true)
        active.values.forEach { it.cancelled.set(true) }
        executor.shutdown()
        if (!executor.awaitTermination(15, TimeUnit.SECONDS)) executor.shutdownNow()
    }
}
