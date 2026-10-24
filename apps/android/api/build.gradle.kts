// The API client, generated from api/openapi.yaml at build time (never committed, so it cannot drift),
// plus the hand-written Transport that adds the bearer token and the request id.
import org.openapitools.generator.gradle.plugin.tasks.GenerateTask

plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.openapi.generator)
}

kotlin {
    jvmToolchain(17)
}

val generatedDir = layout.buildDirectory.dir("generated/openapi")

val generateApi =
    tasks.register<GenerateTask>("generateApi") {
        generatorName.set("kotlin")
        validateSpec.set(false)
        library.set("jvm-ktor")
        inputSpec.set(rootDir.resolve("../../api/openapi.yaml").canonicalPath)
        outputDir.set(generatedDir.map { it.asFile.path })
        packageName.set("app.trycommish.api")
        modelPackage.set("app.trycommish.api.models")
        apiPackage.set("app.trycommish.api.apis")
        generateApiTests.set(false)
        generateModelTests.set(false)
        generateApiDocumentation.set(false)
        generateModelDocumentation.set(false)
        configOptions.set(
            mapOf(
                "serializationLibrary" to "kotlinx_serialization",
                "enumPropertyNaming" to "original",
                "sourceFolder" to "src/main/kotlin",
                "omitGradleWrapper" to "true",
                "dateLibrary" to "string",
            ),
        )
        additionalProperties.set(mapOf("enumUnknownDefaultCase" to "true"))
        // A schema named Companion would shadow Kotlin's companion object.
        modelNameMappings.set(mapOf("Companion" to "DraftCompanion"))
    }

sourceSets.main {
    kotlin.srcDir(generatedDir.map { it.dir("src/main/kotlin") })
}

tasks.named("compileKotlin") { dependsOn(generateApi) }

ktlint {
    filter {
        exclude { it.file.path.contains("/generated/") }
    }
}

tasks.matching { it.name.startsWith("runKtlint") }.configureEach { dependsOn(generateApi) }

dependencies {
    api(libs.ktor.client.core)
    api(libs.ktor.client.content.negotiation)
    api(libs.ktor.serialization.kotlinx.json)
    api(libs.serialization.json)
    implementation(libs.ktor.client.okhttp)

    testImplementation(platform(libs.junit.bom))
    testImplementation(libs.junit.jupiter)
    testRuntimeOnly(libs.junit.platform.launcher)
    testImplementation(libs.ktor.client.mock)
    testImplementation(libs.coroutines.test)
}

tasks.test {
    useJUnitPlatform()
    systemProperty("fixtures", rootDir.resolve("../../shared/fixtures").canonicalPath)
}
