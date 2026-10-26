// Our record screen (the weekly record against ESPN and the week's published projection, the draft
// record against ADP, each week with its status words) and its Paparazzi snapshots, the mock in both
// themes at two phone sizes.
plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.paparazzi)
}

android {
    namespace = "app.trycommish.feature.record"
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
    }
}

kotlin { jvmToolchain(17) }

dependencies {
    implementation(project(":core"))
    implementation(project(":feature:boxscore"))
    implementation(libs.lifecycle.runtime.compose)

    testImplementation(libs.junit4)
    testImplementation(libs.coroutines.test)
    testImplementation(testFixtures(project(":core")))
}
