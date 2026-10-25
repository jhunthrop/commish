// The player sheet's body and the player page (the card, the notes under it, the facts before the season, his
// season, our read, the tier box, the every-format table and the basis, the verb pinned) and their
// Paparazzi snapshots, the mock in both themes at two phone sizes.
plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.paparazzi)
}

android {
    namespace = "app.trycommish.feature.player"
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
    implementation(project(":feature:shell"))
    implementation(libs.lifecycle.runtime.compose)

    testImplementation(libs.junit4)
    testImplementation(libs.coroutines.test)
    testImplementation(testFixtures(project(":core")))
}
