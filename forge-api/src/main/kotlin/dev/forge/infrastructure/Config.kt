package dev.forge.infrastructure

import java.net.URI
import java.nio.file.Path
import org.springframework.core.env.Environment
import org.springframework.stereotype.Component

@Component
class ForgeConfig(private val env: Environment) {
    fun get(key: String, default: String = "") = env.getProperty(key) ?: default

    fun int(key: String, default: Int) = get(key).toIntOrNull() ?: default

    val data: Path = Path.of(get("DATA_DIR", ".data")).toAbsolutePath().normalize()
    val provider
        get() = get("PROVIDER", "demo")

    val capacity
        get() = int("MAX_CONCURRENT_JOBS", 2).coerceIn(1, 32)

    val origins: List<String>
        get() {
            val allowed =
                get("WEB_ORIGIN", "http://127.0.0.1:5179")
                    .split(',')
                    .map { it.trim() }
                    .toMutableSet()
            for (origin in allowed.toList()) {
                val uri = runCatching { URI(origin) }.getOrNull() ?: continue
                if (
                    uri.scheme in listOf("http", "https") &&
                        uri.host in listOf("localhost", "127.0.0.1") &&
                        uri.rawUserInfo == null &&
                        uri.rawPath.isNullOrEmpty() &&
                        uri.rawQuery == null &&
                        uri.rawFragment == null
                ) {
                    val alias = if (uri.host == "localhost") "127.0.0.1" else "localhost"
                    allowed.add(URI(uri.scheme, null, alias, uri.port, null, null, null).toString())
                }
            }
            val port = get("PORT", "3009")
            allowed.add("http://127.0.0.1:$port")
            allowed.add("http://localhost:$port")
            if (get("DESKTOP_CLIENT_ENABLED", "true") == "true") {
                allowed.add("tauri://localhost")
                allowed.add("http://tauri.localhost")
            }
            return allowed.toList()
        }
}
