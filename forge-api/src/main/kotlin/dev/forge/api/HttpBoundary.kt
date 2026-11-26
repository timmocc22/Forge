package dev.forge.api

import dev.forge.infrastructure.*
import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.stereotype.Component
import org.springframework.web.bind.annotation.ExceptionHandler
import org.springframework.web.bind.annotation.RestControllerAdvice
import org.springframework.web.filter.OncePerRequestFilter

@Component
class HttpBoundary(private val config: ForgeConfig) : OncePerRequestFilter() {
    override fun doFilterInternal(
        request: HttpServletRequest,
        response: HttpServletResponse,
        chain: FilterChain,
    ) {
        response.setHeader("X-Request-Id", uid())
        response.setHeader("X-Content-Type-Options", "nosniff")
        response.setHeader("X-Frame-Options", "DENY")
        response.setHeader("Referrer-Policy", "no-referrer")
        response.characterEncoding = "UTF-8"
        val origin = request.getHeader("Origin")
        if (origin != null && origin in config.origins) {
            response.setHeader("Access-Control-Allow-Origin", origin)
            response.setHeader("Vary", "Origin")
            response.setHeader("Access-Control-Allow-Headers", "Content-Type")
            response.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS")
        }
        if (
            request.method in listOf("POST", "PUT", "PATCH", "DELETE") &&
                origin != null &&
                origin !in config.origins
        ) {
            response.status = 403
            response.contentType = "application/json"
            response.writer.write(
                obj("error" to obj("code" to "ORIGIN_DENIED", "message" to "请求来源不允许")).toString()
            )
            return
        }
        if (request.method == "OPTIONS") {
            response.status = 204
            return
        }
        if (request.contentLengthLong > 16 * 1024 * 1024) {
            response.status = 413
            return
        }
        chain.doFilter(request, response)
    }
}

@RestControllerAdvice
class Errors {
    private val logger = org.slf4j.LoggerFactory.getLogger(Errors::class.java)

    @ExceptionHandler(ApiError::class)
    fun expected(error: ApiError) =
        ResponseEntity.status(error.status)
            .contentType(MediaType.APPLICATION_JSON)
            .body(obj("error" to obj("code" to error.code, "message" to error.message)).toString())

    @ExceptionHandler(Exception::class)
    fun unexpected(error: Exception): ResponseEntity<String> {
        if (error is org.springframework.web.servlet.resource.NoResourceFoundException) {
            return ResponseEntity.status(404)
                .contentType(MediaType.APPLICATION_JSON)
                .body(obj("error" to obj("code" to "HTTP_404", "message" to "接口不存在")).toString())
        }
        val validation =
            error is org.springframework.http.converter.HttpMessageNotReadableException ||
                error is org.springframework.web.bind.MissingServletRequestParameterException
        if (!validation) logger.error("Unhandled request failure", error)
        return ResponseEntity.status(if (validation) 400 else 500)
            .contentType(MediaType.APPLICATION_JSON)
            .body(
                obj(
                        "error" to
                            obj(
                                "code" to if (validation) "VALIDATION_ERROR" else "HTTP_500",
                                "message" to if (validation) "请求格式不正确" else "服务暂时不可用，请稍后重试",
                            )
                    )
                    .toString()
            )
    }
}
