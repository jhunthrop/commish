// The store graphics' image writing (java.awt and ImageIO), on the JVM: an Android module's unit tests compile
// against android.jar, which has no java.awt, so :storeshots reaches Paparazzi's frames through this module.
plugins {
    alias(libs.plugins.kotlin.jvm)
}

kotlin { jvmToolchain(17) }

dependencies {
    // The SnapshotHandler interface only; :storeshots brings Paparazzi itself at run time.
    compileOnly("app.cash.paparazzi:paparazzi:${libs.versions.paparazzi.get()}") { isTransitive = false }
}
