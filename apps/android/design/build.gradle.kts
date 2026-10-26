// The design: Task A's generated Tokens.kt and Words.kt (shared/design, shared/words), the Material 3
// theme in both schemes, the three faces, and the shared composables every screen draws with, a
// player's face among them, loaded through Coil with a disk cache.
plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.android.junit5)
    alias(libs.plugins.paparazzi)
}

android {
    namespace = "app.trycommish.design"
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
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures { compose = true }
    testOptions.unitTests.all {
        it.systemProperty("repository", rootDir.resolve("../..").canonicalPath)
    }
}

kotlin { jvmToolchain(17) }

dependencies {
    api(platform(libs.compose.bom))
    api(libs.compose.ui)
    api(libs.compose.ui.graphics)
    api(libs.compose.foundation)
    api(libs.compose.material3)
    api(libs.compose.ui.tooling.preview)
    debugImplementation(libs.compose.ui.tooling)
    implementation(libs.coil.compose)
    implementation(libs.coil.network.okhttp)

    testImplementation(platform(libs.junit.bom))
    testImplementation(libs.junit.jupiter)
    testRuntimeOnly(libs.junit.platform.launcher)
    // The specimen is a Paparazzi rule, a JUnit 4 test, run on the platform beside the JUnit 5 ones.
    testImplementation(libs.junit4)
    testImplementation(libs.coroutines.test)
    testRuntimeOnly(libs.junit.vintage.engine)
}
