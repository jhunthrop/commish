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

android {
    namespace = "app.trycommish.android"
    compileSdk = 35

    defaultConfig {
        applicationId = "app.trycommish.android"
        minSdk = 26
        targetSdk = 35
        versionCode = (System.getenv("ANDROID_VERSION_CODE") ?: "1").toInt()
        versionName = "0.1.0"
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
        }
        release {
            isMinifyEnabled = false
            buildConfigField("String", "API_BASE_URL", "\"https://api.trycommish.app\"")
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
    testOptions.unitTests.all {
        it.systemProperty("repository", rootDir.resolve("../..").canonicalPath)
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
    implementation(project(":feature:rankings"))
    implementation(project(":feature:record"))
    implementation(libs.activity.compose)
    implementation(libs.lifecycle.viewmodel.compose)
    implementation(libs.lifecycle.runtime.compose)
    implementation(libs.navigation.compose)
    implementation(libs.browser)
    implementation(libs.coroutines.android)

    testImplementation(libs.junit4)
    testImplementation(libs.serialization.json)
}
