// The app: the five tabs, sign-in through a Custom Tab onto the device bearer path, the League, Lineup, Matchup and Waivers live,
// the hand-built graph that wires the modules. A debug build reads the API on the host machine from the
// emulator (10.0.2.2); a release build reads production. Release signing comes from the environment
// (CI secrets), never from the repository.
plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
}

/** The site, and the app link the API's sign-in returns to (the web serves its assetlinks.json). */
val siteUrl = "https://trycommish.app"
val returnTo = "$siteUrl/app/signed-in"

/**
 * The version Play shows, and the version code under every upload, never hand-edited: a fixed offset,
 * then CI's run number (ANDROID_RUN_NUMBER, github.run_number) times ten, plus the attempt
 * (ANDROID_RUN_ATTEMPT, github.run_attempt) less one. A re-run keeps its run number, so the attempt
 * is what gives it a code Play has not used; ten attempts per run keep codes rising from one run to
 * the next. A local build without either is the offset alone, below every CI code.
 */
val marketingVersion = "0.1.0"
val versionCodeOffset = 1000
val attemptsPerRun = 10

fun versionCodeOf(
    runNumber: Int,
    runAttempt: Int,
): Int {
    require(runNumber >= 0) { "ANDROID_RUN_NUMBER must not be negative, not $runNumber" }
    require(runAttempt in 1..attemptsPerRun) { "ANDROID_RUN_ATTEMPT must be 1 to $attemptsPerRun, not $runAttempt" }
    return versionCodeOffset + runNumber * attemptsPerRun + (runAttempt - 1)
}

val appVersionCode =
    versionCodeOf(
        runNumber = System.getenv("ANDROID_RUN_NUMBER")?.toInt() ?: 0,
        runAttempt = System.getenv("ANDROID_RUN_ATTEMPT")?.toInt() ?: 1,
    )

/** The rule's arithmetic, run before the unit tests: every case below must hold. */
val verifyVersionCodeRule by tasks.registering {
    group = "verification"
    description = "Checks the version code rule against fixed runs and attempts."
    doLast {
        val cases =
            listOf(
                Triple(0, 1, 1000),
                Triple(223, 1, 3230),
                Triple(223, 2, 3231),
                Triple(223, 10, 3239),
                Triple(224, 1, 3240),
            )
        cases.forEach { (run, attempt, expected) ->
            val actual = versionCodeOf(run, attempt)
            check(actual == expected) { "run $run attempt $attempt gave $actual, not $expected" }
        }
        check(versionCodeOf(223, 10) < versionCodeOf(224, 1)) { "a run's last attempt must stay below the next run" }
        listOf(0, attemptsPerRun + 1).forEach { attempt ->
            check(runCatching { versionCodeOf(1, attempt) }.isFailure) { "attempt $attempt must be refused" }
        }
        check(runCatching { versionCodeOf(-1, 1) }.isFailure) { "a negative run number must be refused" }
    }
}
tasks.matching { it.name == "testDebugUnitTest" }.configureEach { dependsOn(verifyVersionCodeRule) }

android {
    namespace = "app.trycommish.android"
    compileSdk =
        libs.versions.android.compile.sdk
            .get()
            .toInt()

    defaultConfig {
        applicationId = "app.trycommish.android"
        minSdk =
            libs.versions.android.min.sdk
                .get()
                .toInt()
        targetSdk =
            libs.versions.android.target.sdk
                .get()
                .toInt()
        versionCode = appVersionCode
        versionName = marketingVersion
        buildConfigField("String", "SITE_URL", "\"$siteUrl\"")
        buildConfigField("String", "RETURN_TO", "\"$returnTo\"")
    }

    signingConfigs {
        val keystore = System.getenv("ANDROID_KEYSTORE_PATH")
        if (keystore != null) {
            create("release") {
                storeFile = file(keystore)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        debug {
            buildConfigField("String", "API_BASE_URL", "\"${System.getenv("COMMISH_API_BASE_URL") ?: "http://10.0.2.2:8080"}\"")
            // The host a sign-out's logout URL must name: WorkOS's API, or a rehearsal's own stub in a debug
            // build only (Lane 236).
            buildConfigField("String", "WORKOS_LOGOUT_HOST", "\"${System.getenv("COMMISH_WORKOS_LOGOUT_HOST") ?: "api.workos.com"}\"")
        }
        release {
            isMinifyEnabled = false
            buildConfigField("String", "API_BASE_URL", "\"https://api.trycommish.app\"")
            buildConfigField("String", "WORKOS_LOGOUT_HOST", "\"api.workos.com\"")
            signingConfig = signingConfigs.findByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    testOptions.unitTests.isIncludeAndroidResources = true
    testOptions.unitTests.all {
        it.systemProperty("repository", rootDir.resolve("../..").canonicalPath)
        it.systemProperty("fixtures", rootDir.resolve("../../shared/fixtures").canonicalPath)
    }
    lint {
        warningsAsErrors = false
        abortOnError = true
    }
}

kotlin { jvmToolchain(17) }

dependencies {
    implementation(project(":core"))
    implementation(project(":feature:leaguehome"))
    implementation(project(":feature:matchup"))
    implementation(project(":feature:board"))
    implementation(project(":feature:shell"))
    implementation(project(":feature:start"))
    implementation(project(":feature:waivers"))
    implementation(project(":feature:trades"))
    implementation(project(":feature:player"))
    implementation(project(":feature:rankings"))
    implementation(project(":feature:record"))
    implementation(project(":feature:account"))
    implementation(project(":feature:reference"))
    implementation(project(":feature:companion"))
    implementation(project(":feature:mock"))
    implementation(project(":feature:sheet"))
    implementation(libs.activity.compose)
    implementation(libs.lifecycle.viewmodel.compose)
    implementation(libs.lifecycle.runtime.compose)
    implementation(libs.navigation.compose)
    implementation(libs.browser)
    implementation(libs.coroutines.android)

    testImplementation(libs.junit4)
    testImplementation(libs.serialization.json)
    testImplementation(testFixtures(project(":core")))
    testImplementation(platform(libs.compose.bom))
    testImplementation(libs.compose.ui.test.junit4)
    testImplementation(libs.robolectric)
    debugImplementation(platform(libs.compose.bom))
    debugImplementation(libs.compose.ui.test.manifest)
}
