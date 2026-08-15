pluginManagement {
    repositories {
        google()
        gradlePluginPortal()
        mavenCentral()
    }
}

dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "milano-compose-sample"

// Source consumption of the engine, exactly as documented for consumers:
// the composite build substitutes dev.get-milano:engine-compose.
includeBuild("../../engine/compose")

include(":app")
