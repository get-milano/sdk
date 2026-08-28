import org.jetbrains.compose.desktop.application.dsl.TargetFormat

plugins {
    kotlin("jvm") version "2.3.20"
    kotlin("plugin.compose") version "2.3.20"
    id("org.jetbrains.compose") version "1.12.0"
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
val documents = "src/main/resources/documents"
val bindings = "src/main/kotlin/dev/getmilano/sample/desktop/milanobridge/GeneratedBindings.kt"

val generateMilanoBindings =
    tasks.register<Exec>("generateMilanoBindings") {
        inputs.file("$documents/vocabulary.json")
        inputs.files(milanoCli)
        outputs.file(bindings)
        doFirst { check(file(milanoCli).exists()) { milanoCliMissing } }
        commandLine(
            "node",
            milanoCli,
            "bindings",
            "$documents/vocabulary.json",
            "--kotlin-package",
            "dev.getmilano.sample.desktop.milanobridge",
            "--kotlin-out",
            bindings,
        )
    }

// Every bundled document is validated through the engine's gate before
// each build: a document the engines would reject fails the build here,
// with the same typed error. Context and state values are synthesized.
val validateMilanoDocuments =
    tasks.register<Exec>("validateMilanoDocuments") {
        val documentFiles =
            fileTree(documents) {
                include("*.json")
                exclude("vocabulary.json")
            }.files.map { it.path }.sorted()
        inputs.dir(documents)
        outputs.upToDateWhen { false }
        doFirst { check(file(milanoCli).exists()) { milanoCliMissing } }
        commandLine(
            listOf("node", milanoCli, "validate") + documentFiles +
                listOf("--vocabulary", "$documents/vocabulary.json"),
        )
    }

// The vocabulary-specific document schema, for editors and producer CI.
val generateMilanoDocumentSchema =
    tasks.register<Exec>("generateMilanoDocumentSchema") {
        inputs.file("$documents/vocabulary.json")
        inputs.files(milanoCli)
        outputs.file(rootDir.resolve("documents.schema.json"))
        doFirst { check(file(milanoCli).exists()) { milanoCliMissing } }
        commandLine(
            "node",
            milanoCli,
            "schema",
            "$documents/vocabulary.json",
            "--out",
            rootDir.resolve("documents.schema.json").path,
        )
    }

tasks.named("compileKotlin") {
    dependsOn(generateMilanoBindings, validateMilanoDocuments, generateMilanoDocumentSchema)
}

dependencies {
    // Substituted from source by the composite build in settings.gradle.kts.
    implementation("dev.get-milano:engine-compose:2.0.0")

    implementation(compose.desktop.currentOs)
    implementation(compose.material3)
    // The Pokemon screen parses PokeAPI's answer; the engine's own JSON
    // reader is internal to it.
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.9.0")
}

compose.desktop {
    application {
        mainClass = "dev.getmilano.sample.desktop.MainKt"
        nativeDistributions {
            targetFormats(TargetFormat.Dmg, TargetFormat.Msi, TargetFormat.Deb)
            packageName = "MilanoSample"
            packageVersion = "2.0.0"
            description = "Milano SDK demos"
            vendor = "get-milano.dev"
        }
    }
}
