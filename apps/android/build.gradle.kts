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
    alias(libs.plugins.google.services) apply false
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

// The Paparazzi references are the Linux CI image (record them with the record job in
// .github/workflows/android.yml, never from a Mac). A Mac draws anti-aliased edges one colour level
// off, so a local verifyPaparazziDebug would fail on a rendering difference, and a tolerance loose
// enough to pass it would also pass a changed digit. On a Mac outside CI verifyPaparazziDebug
// therefore compares nothing and prints why (exit 0): CI is the reference. -PpaparazziVerify=run forces the comparison anyway.
val paparazziVerifyProperty = "paparazziVerify"
val paparazziVerifyForce = "run"
val paparazziSkipReason =
    "verifyPaparazziDebug skipped on this Mac: the references are the CI image and a Mac draws " +
        "edges one colour level off, so the android workflow on CI is the reference. " +
        "Pass -P$paparazziVerifyProperty=$paparazziVerifyForce to compare anyway."
val skipPaparazziVerifyHere =
    System.getenv("CI") == null &&
        System.getProperty("os.name").startsWith("Mac") &&
        providers.gradleProperty(paparazziVerifyProperty).orNull != paparazziVerifyForce

if (skipPaparazziVerifyHere) {
    gradle.taskGraph.whenReady {
        if (allTasks.any { it.name == "verifyPaparazziDebug" }) logger.lifecycle(paparazziSkipReason)
    }
    subprojects {
        // verifyPaparazziDebug is the unit tests run with the plugin's verify flag on; the flag is
        // turned off here, last, so the tests still render (a crash still fails) but compare nothing.
        tasks.withType<Test>().configureEach {
            doFirst {
                if (systemProperties["paparazzi.test.verify"]?.toString() == true.toString()) {
                    systemProperty("paparazzi.test.verify", false.toString())
                }
            }
        }
    }
}
