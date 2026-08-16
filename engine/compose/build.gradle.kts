plugins {
    kotlin("multiplatform") version "2.3.20"
    kotlin("plugin.serialization") version "2.3.20"
    kotlin("plugin.compose") version "2.3.20"
    id("com.android.library") version "8.13.0"
    id("maven-publish")
}

group = "dev.get-milano"
// The release workflow passes -PmilanoVersion=<x.y.z>; local builds default.
version = (findProperty("milanoVersion") as? String) ?: "0.0.0-dev"

repositories {
    mavenCentral()
    google()
}

kotlin {
    jvmToolchain(17)

    // The engine core lives in commonMain: pure Kotlin, no platform APIs by
    // construction. The jvm target carries the conformance harness and covers
    // desktop; androidTarget keeps the Android library buildable from M1 on.
    jvm()
    androidTarget {
        publishLibraryVariants("release")
    }

    sourceSets {
        commonMain.dependencies {
            implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.9.0")
            implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.10.2")
            // The engine renders nothing itself: only the Compose runtime,
            // no UI artifacts.
            api("org.jetbrains.compose.runtime:runtime:1.9.0")
        }
        commonTest.dependencies {
            implementation(kotlin("test"))
        }
    }
}

android {
    namespace = "dev.getmilano"
    compileSdk = 36
    defaultConfig {
        minSdk = 26
    }
}

publishing {
    repositories {
        maven {
            name = "GitHubPackages"
            url = uri("https://maven.pkg.github.com/get-milano/sdk")
            credentials {
                username = System.getenv("GITHUB_ACTOR")
                password = System.getenv("GITHUB_TOKEN")
            }
        }
    }
}
