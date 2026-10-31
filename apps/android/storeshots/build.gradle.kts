// The Play store graphics (docs/store/play-graphics), drawn by the app's own Compose screens over the shared
// fixtures with Paparazzi: the eight phone screenshots with their captions, the feature graphic, and the
// store icon re-saved with alpha. Test code only, and it draws nothing unless -PstoreGraphics names the
// folder to write: node apps/android/scripts/store-graphics.ts runs it.
plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.paparazzi)
}

// The shared fixtures with the recorded league's names replaced (shared/store/store-names.json says why;
// the App Store shots read the same file, apps/ios/scripts/store-shots.ts).
val storeNames = rootDir.resolve("../../shared/store/store-names.json")

@Suppress("UNCHECKED_CAST")
val namePairs: List<List<String>> =
    (groovy.json.JsonSlurper().parse(storeNames) as Map<String, Any>)["replace"] as List<List<String>>

val storeFixtures =
    tasks.register<Sync>("storeFixtures") {
        from(rootDir.resolve("../../shared/fixtures"))
        into(layout.buildDirectory.dir("store-fixtures"))
        inputs.file(storeNames)
        filesMatching("**/*.json") {
            filter { line -> namePairs.fold(line) { text, (from, to) -> text.replace(from, to) } }
        }
    }

android {
    namespace = "app.trycommish.storeshots"
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
        // Asked for, the run copies the fixtures and draws; otherwise every test here is skipped (CI).
        providers.gradleProperty("storeGraphics").orNull?.let { out ->
            it.dependsOn(storeFixtures)
            it.systemProperty(
                "fixtures",
                layout.buildDirectory
                    .dir("store-fixtures")
                    .get()
                    .asFile.canonicalPath,
            )
            it.systemProperty("webIcon", rootDir.resolve("../../web/static/icons/icon-512.png").canonicalPath)
            it.systemProperty("storeGraphics", File(out).canonicalPath)
            it.outputs.upToDateWhen { false }
        }
        // Each class in a JVM of its own: layoutlib keeps the number face's first variation (B191).
        it.forkEvery = 1
    }
}

kotlin { jvmToolchain(17) }

dependencies {
    testImplementation(project(":storeshots-png"))
    implementation(project(":core"))
    implementation(project(":feature:boxscore"))
    implementation(project(":feature:shell"))
    implementation(project(":feature:start"))
    implementation(project(":feature:waivers"))
    implementation(project(":feature:trades"))
    implementation(project(":feature:matchup"))
    implementation(project(":feature:rankings"))
    implementation(project(":feature:board"))
    implementation(project(":feature:mock"))
    implementation(project(":feature:player"))
    implementation(libs.lifecycle.runtime.compose)
    testImplementation(libs.junit4)
    testImplementation(libs.coroutines.test)
    testImplementation(testFixtures(project(":core")))
}
