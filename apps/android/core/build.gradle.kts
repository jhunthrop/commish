// Models, view models, the clock, the session and the cache. View models hold no Android types beyond
// androidx's ViewModel, so their tests run on the JVM against shared/fixtures with a fixed clock.
plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.android.junit5)
    alias(libs.plugins.kotlin.serialization)
}

android {
    namespace = "app.trycommish.core"
    compileSdk =
        libs.versions.android.compile.sdk
            .get()
            .toInt()
    defaultConfig {
        minSdk =
            libs.versions.android.min.sdk
                .get()
                .toInt()
    }
    testFixtures { enable = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    testOptions.unitTests.all {
        it.systemProperty("fixtures", rootDir.resolve("../../shared/fixtures").canonicalPath)
    }
}

kotlin { jvmToolchain(17) }

dependencies {
    api(project(":api"))
    api(project(":design"))
    api(libs.lifecycle.viewmodel)
    api(libs.coroutines.core)
    implementation(libs.security.crypto)
    implementation(libs.okhttp)

    testImplementation(platform(libs.junit.bom))
    testImplementation(libs.junit.jupiter)
    testRuntimeOnly(libs.junit.platform.launcher)
    testImplementation(libs.coroutines.test)
    testImplementation(libs.ktor.client.mock)
    testImplementation(libs.okhttp.mockwebserver)
}
