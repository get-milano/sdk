plugins {
    // AGP 9 compiles Kotlin itself, so there is no kotlin("android") plugin
    // here: applying it is an error since AGP 9.0.
    id("com.android.application") version "9.3.1"
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
        versionName = "1.0.0"
    }

    buildFeatures {
        compose = true
    }
}

kotlin {
    jvmToolchain(17)
}

// Typed bindings are generated from the vocabulary as a build step: the
// committed GeneratedBindings.kt is refreshed before every compile, so it
// can never drift from vocabulary.json. The generator lives in the specs
// repository (sibling checkout, or MILANO_SPECS_DIR).
val generateMilanoBindings =
    tasks.register<Exec>("generateMilanoBindings") {
        val specsDir =
            System.getenv("MILANO_SPECS_DIR")
                ?: rootDir.resolve("../../../specs").canonicalPath
        inputs.file("src/main/assets/vocabulary.json")
        inputs.file("$specsDir/tools/generate_bindings.py")
        outputs.file("src/main/kotlin/dev/getmilano/sample/milanobridge/GeneratedBindings.kt")
        commandLine(
            "python3",
            "$specsDir/tools/generate_bindings.py",
            "src/main/assets/vocabulary.json",
            "--kotlin-package",
            "dev.getmilano.sample.milanobridge",
            "--kotlin-out",
            "src/main/kotlin/dev/getmilano/sample/milanobridge/GeneratedBindings.kt",
        )
    }

// Every bundled document is validated through the reference gate before
// each build: a document the engines would reject fails the build here,
// with the same typed error. Context and state values are synthesized.
val validateMilanoDocuments =
    tasks.register<Exec>("validateMilanoDocuments") {
        val specsDir =
            System.getenv("MILANO_SPECS_DIR")
                ?: rootDir.resolve("../../../specs").canonicalPath
        inputs.dir("src/main/assets")
        outputs.upToDateWhen { false }
        commandLine(
            "sh",
            "-c",
            "for f in src/main/assets/*.json; do " +
                "[ \"$(basename \"${'$'}f\")\" = vocabulary.json ] && continue; " +
                "python3 \"$specsDir/tools/reference_check.py\" --document \"${'$'}f\" " +
                "--vocabulary src/main/assets/vocabulary.json || exit 1; done",
        )
    }

// The vocabulary-specific document schema, for editors and producer CI.
val generateMilanoDocumentSchema =
    tasks.register<Exec>("generateMilanoDocumentSchema") {
        val specsDir =
            System.getenv("MILANO_SPECS_DIR")
                ?: rootDir.resolve("../../../specs").canonicalPath
        inputs.file("src/main/assets/vocabulary.json")
        outputs.file(rootDir.resolve("documents.schema.json"))
        commandLine(
            "python3",
            "$specsDir/tools/generate_document_schema.py",
            "src/main/assets/vocabulary.json",
            "--out",
            rootDir.resolve("documents.schema.json").path,
        )
    }

tasks.named("preBuild") {
    dependsOn(generateMilanoBindings, validateMilanoDocuments, generateMilanoDocumentSchema)
}

dependencies {
    // Substituted from source by the composite build in settings.gradle.kts.
    implementation("dev.get-milano:engine-compose:1.1.0")

    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.compose.material3:material3:1.3.1")
    implementation("io.coil-kt:coil-compose:2.7.0")
}
