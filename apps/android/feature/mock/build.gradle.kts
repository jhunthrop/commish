// The mock room (the setup, the room full screen with its bar, the report, a shared draft) and its Paparazzi
// snapshots, the mock in both themes at two phone sizes, drawn to the approved iOS screen (Lane 213).
plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.paparazzi)
}

android {
    namespace = "app.trycommish.feature.mock"
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
        it.systemProperty("fixtures", rootDir.resolve("../../shared/fixtures").canonicalPath)
        // Each snapshot class in a JVM of its own: layoutlib keeps the interface face's variations as the first
        // class to draw resolved them (B191), so the lobby's scenes drawn first redrew every mock reference.
        it.forkEvery = 1
    }
}

kotlin { jvmToolchain(17) }

dependencies {
    implementation(project(":core"))
    implementation(project(":feature:boxscore"))
    implementation(project(":feature:board"))
    implementation(project(":feature:companion"))
    implementation(libs.lifecycle.runtime.compose)
    implementation(libs.activity.compose)

    testImplementation(libs.junit4)
    testImplementation(libs.coroutines.test)
    testImplementation(testFixtures(project(":core")))
}
