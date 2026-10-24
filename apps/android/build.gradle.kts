// The Commish Android app: one Gradle build, the modules named in settings.gradle.kts. Versions live
// in gradle/libs.versions.toml, ktlint runs on every module.
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.android.library) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.jvm) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.android.junit5) apply false
    alias(libs.plugins.paparazzi) apply false
    alias(libs.plugins.openapi.generator) apply false
    alias(libs.plugins.ktlint) apply false
}

subprojects {
    apply(plugin = "org.jlleitschuh.gradle.ktlint")
    configure<org.jlleitschuh.gradle.ktlint.KtlintExtension> {
        version.set("1.4.1")
        android.set(true)
        filter {
            exclude { it.file.path.contains("/build/") }
        }
    }
}
