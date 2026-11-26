plugins {
    kotlin("jvm") version "2.4.21"
    kotlin("plugin.spring") version "2.4.21"
    id("org.springframework.boot") version "4.1.2"
    id("io.spring.dependency-management") version "1.1.7"
}

group = "dev.forge"

version = "0.1.0"

repositories {
    mavenCentral()
    maven("https://repo1.maven.org/maven2")
}

kotlin { jvmToolchain(25) }

dependencies {
    implementation("org.springframework.boot:spring-boot-starter-webmvc")
    implementation("org.springframework.boot:spring-boot-starter-jdbc")
    implementation("org.springframework.boot:spring-boot-starter-actuator")
    implementation(kotlin("reflect"))
    implementation("com.fasterxml.jackson.core:jackson-databind:2.20.1")
    implementation("com.networknt:json-schema-validator:1.5.9")
    implementation("org.xerial:sqlite-jdbc:3.51.3.0")
    implementation("org.postgresql:postgresql")
    implementation("org.jsoup:jsoup:1.21.2")
    testImplementation("org.springframework:spring-test")
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.test { useJUnitPlatform() }

val formatter by configurations.creating {
    attributes {
        attribute(
            org.gradle.api.attributes.Bundling.BUNDLING_ATTRIBUTE,
            objects.named(
                org.gradle.api.attributes.Bundling::class.java,
                org.gradle.api.attributes.Bundling.SHADOWED,
            ),
        )
    }
}

dependencies { formatter("com.facebook:ktfmt:0.64") }

repositories { mavenCentral() }

fun kotlinSources() =
    fileTree(rootDir) {
            include("src/**/*.kt", "*.gradle.kts")
            exclude("**/build/**", "**/.gradle/**")
        }
        .files
        .map { it.absolutePath }

tasks.register<JavaExec>("formatKotlin") {
    classpath = formatter
    mainClass.set("com.facebook.ktfmt.cli.Main")
    args("--kotlinlang-style", "--enable-editorconfig")
    args(kotlinSources())
}

tasks.register<JavaExec>("checkKotlinFormat") {
    classpath = formatter
    mainClass.set("com.facebook.ktfmt.cli.Main")
    args("--kotlinlang-style", "--enable-editorconfig", "--dry-run", "--set-exit-if-changed")
    args(kotlinSources())
}

tasks.named("check") { dependsOn("checkKotlinFormat") }

// Consumer snapshot only: no source dependency on the knowledge application.
tasks.processResources {
    from("contracts/forge-knowledge.v1.openapi.json") {
        into("knowledge-contract")
        rename { "openapi.v1.json" }
    }
}
