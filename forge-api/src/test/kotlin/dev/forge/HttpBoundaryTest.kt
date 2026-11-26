package dev.forge

import dev.forge.api.HttpBoundary
import dev.forge.infrastructure.ForgeConfig
import dev.forge.infrastructure.parse
import dev.forge.infrastructure.s
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.mock.env.MockEnvironment
import org.springframework.mock.web.MockHttpServletRequest
import org.springframework.mock.web.MockHttpServletResponse

class HttpBoundaryTest {
    private fun request(configuredOrigin: String, origin: String): MockHttpServletResponse {
        val config = ForgeConfig(MockEnvironment().withProperty("WEB_ORIGIN", configuredOrigin))
        val request = MockHttpServletRequest("PATCH", "/api/html-projects/project/commands/command")
        request.addHeader("Origin", origin)
        val response = MockHttpServletResponse()
        HttpBoundary(config).doFilter(request, response) { _, result ->
            (result as jakarta.servlet.http.HttpServletResponse).status = 204
        }
        return response
    }

    @Test
    fun `loopback web aliases can steer commands using the same scheme and port`() {
        for (configured in listOf("http://127.0.0.1:5179", "http://localhost:5179")) {
            for (origin in listOf("http://127.0.0.1:5179", "http://localhost:5179")) {
                val response = request(configured, origin)
                assertEquals(204, response.status)
                assertEquals(origin, response.getHeader("Access-Control-Allow-Origin"))
            }
        }
        assertEquals(204, request("https://localhost:5179", "https://127.0.0.1:5179").status)
    }

    @Test
    fun `untrusted origins and differing schemes or ports remain denied with readable errors`() {
        for (origin in
            listOf(
                "http://localhost:5180",
                "https://localhost:5179",
                "http://localhost.attacker.example:5179",
                "https://attacker.example",
            )) {
            val response = request("http://127.0.0.1:5179", origin)
            assertEquals(403, response.status)
            assertNull(response.getHeader("Access-Control-Allow-Origin"))
            val error = parse(response.contentAsString).path("error")
            assertEquals("ORIGIN_DENIED", error.s("code"))
            assertEquals("请求来源不允许", error.s("message"))
        }
        assertEquals(403, request("https://forge.example", "http://localhost:5179").status)
    }
}
