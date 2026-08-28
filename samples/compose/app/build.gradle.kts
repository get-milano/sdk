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
        versionName = "2.0.0"
    }

    buildFeatures {
        compose = true
    }
}

kotlin {
    jvmToolchain(17)
}

// Producer tooling as build steps, through the Milano CLI (`milano` from
// `@get-milano/cli`): typed bindings and the editor schema are regenerated
// from the vocabulary before every compile, and every bundled document is
// validated with the gate the engines run, so none of them can drift. A
// consumer project runs the same three commands as `npx milano ...`; inside
// this repository the CLI is the workspace package, built by `npm ci &&
// npm run build` at the repository root.
val milanoCli: String = rootDir.resolve("../../cli/dist/bin.js").canonicalPath
val milanoCliMissing =
    "Milano CLI not built at $milanoCli: run `npm ci && npm run build` at the repository root"

val generateMilanoBindings =
    tasks.register<Exec>("generateMilanoBindings") {
        inputs.file("src/main/assets/vocabulary.json")
        inputs.file(milanoCli)
        outputs.file("src/main/kotlin/dev/getmilano/sample/milanobridge/GeneratedBindings.kt")
        doFirst { check(file(milanoCli).exists()) { milanoCliMissing } }
        commandLine(
            "node",
            milanoCli,
            "bindings",
            "src/main/assets/vocabulary.json",
            "--kotlin-package",
            "dev.getmilano.sample.milanobridge",
            "--kotlin-out",
            "src/main/kotlin/dev/getmilano/sample/milanobridge/GeneratedBindings.kt",
        )
    }

// Every bundled document is validated through the engine's gate before
// each build: a document the engines would reject fails the build here,
// with the same typed error. Context and state values are synthesized.
val validateMilanoDocuments =
    tasks.register<Exec>("validateMilanoDocuments") {
        val documentFiles =
            fileTree("src/main/assets") {
                include("*.json")
                exclude("vocabulary.json")
            }.files.map { it.path }.sorted()
        inputs.dir("src/main/assets")
        outputs.upToDateWhen { false }
        doFirst { check(file(milanoCli).exists()) { milanoCliMissing } }
        commandLine(
            listOf("node", milanoCli, "validate") + documentFiles +
                listOf("--vocabulary", "src/main/assets/vocabulary.json"),
        )
    }

// The vocabulary-specific document schema, for editors and producer CI.
val generateMilanoDocumentSchema =
    tasks.register<Exec>("generateMilanoDocumentSchema") {
        inputs.file("src/main/assets/vocabulary.json")
        inputs.file(milanoCli)
        outputs.file(rootDir.resolve("documents.schema.json"))
        doFirst { check(file(milanoCli).exists()) { milanoCliMissing } }
        commandLine(
            "node",
            milanoCli,
            "schema",
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
    implementation("dev.get-milano:engine-compose:2.0.0")

    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.compose.material3:material3:1.3.1")
    implementation("io.coil-kt:coil-compose:2.7.0")
}
