pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
        google()
    }
}

dependencyResolutionManagement {
    repositories {
        mavenCentral()
        google()
    }
}

rootProject.name = "milano-compose-desktop-sample"

// Source consumption of the engine, exactly as documented for consumers:
// the composite build substitutes dev.get-milano:engine-compose with its
// JVM target. The engine's build also declares an Android target, so
// configuring it needs an Android SDK on the machine (ANDROID_HOME); a
// desktop-only consumer takes the published JVM artifact instead.
includeBuild("../../engine/compose")
