// The Matchup screen (this week's game as a box score: the score bug, both teams' boxes, the basis)
// and its Paparazzi snapshots, the mock in both themes at two phone sizes.
plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.paparazzi)
}

android {
    namespace = "app.trycommish.feature.matchup"
    compileSdk = 35
    defaultConfig { minSdk = 26 }
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
    testImplementation(testFixtures(project(":core")))
}
