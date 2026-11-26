package dev.forge

import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.file.Path
import java.time.Duration
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import org.springframework.boot.builder.SpringApplicationBuilder
import org.springframework.boot.web.server.servlet.context.ServletWebServerApplicationContext

class BrowserLocaleTest {
    @TempDir lateinit var directory: Path

    @Test
    fun `browser with more than ten preferred languages can load initial API data`() {
        SpringApplicationBuilder(ForgeApplication::class.java)
            .run(
                "--server.port=0",
                "--DATA_DIR=$directory",
                "--spring.config.import=",
                "--PROVIDER=demo",
                "--KNOWLEDGE_URL=",
                "--IMPORT_LEGACY_DIR=",
            )
            .use { context ->
                val port =
                    requireNotNull((context as ServletWebServerApplicationContext).webServer).port
                val client = HttpClient.newHttpClient()
                val languages = "zh-CN,zh,en-US,en,ja,ko,fr,de,es,it,pt,ru,ar"
                for (languageHeader in listOf("zh-CN,zh;q=0.9,en;q=0.8", languages)) {
                    for (path in
                        listOf(
                            "/api/health",
                            "/api/providers",
                            "/api/html-projects",
                            "/api/html-projects/storage/status",
                        )) {
                        val request =
                            HttpRequest.newBuilder(URI("http://127.0.0.1:$port$path"))
                                .timeout(Duration.ofSeconds(5))
                                .header("Accept-Language", languageHeader)
                                .GET()
                                .build()
                        val response = client.send(request, HttpResponse.BodyHandlers.ofString())
                        assertEquals(200, response.statusCode(), "$path: ${response.body()}")
                    }
                }
            }
    }
}
