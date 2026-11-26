package dev.forge.infrastructure

import org.springframework.boot.tomcat.TomcatConnectorCustomizer
import org.springframework.boot.tomcat.servlet.TomcatServletWebServerFactory
import org.springframework.boot.web.server.WebServerFactoryCustomizer
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration

@Configuration(proxyBeanMethods = false)
class BrowserLocaleConfiguration {
    @Bean
    fun browserLocales(): WebServerFactoryCustomizer<TomcatServletWebServerFactory> =
        WebServerFactoryCustomizer { factory ->
            factory.addConnectorCustomizers(
                TomcatConnectorCustomizer { connector ->
                    // Browser language preferences may exceed Tomcat's default of ten locales.
                    // The connector's HTTP header size limit still bounds the request.
                    connector.maxLocaleCount = -1
                }
            )
        }
}
