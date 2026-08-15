plugins {
    id("com.android.application") version "8.13.0"
    kotlin("android") version "2.3.20"
    kotlin("plugin.compose") version "2.3.20"
}

android {
    namespace = "dev.getmilano.sample"
    compileSdk = 36

    defaultConfig {
        applicationId = "dev.getmilano.sample"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
    }

    buildFeatures {
        compose = true
    }
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    // Substituted from source by the composite build in settings.gradle.kts.
    implementation("dev.get-milano:engine-compose:0.1.0")

    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.compose.material3:material3:1.3.1")
    implementation("io.coil-kt:coil-compose:2.7.0")
}
