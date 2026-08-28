import org.jetbrains.compose.desktop.application.dsl.TargetFormat

plugins {
    kotlin("jvm") version "2.3.20"
    kotlin("plugin.compose") version "2.3.20"
    id("org.jetbrains.compose") version "1.12.0"
}

kotlin {
    jvmToolchain(17)
}

// Typed bindings are generated from the vocabulary as a build step: the
// committed GeneratedBindings.kt is refreshed before every compile, so it
// can never drift from vocabulary.json. The generator lives in the specs
// repository (sibling checkout, or MILANO_SPECS_DIR).
val specsDir: String =
    System.getenv("MILANO_SPECS_DIR")
        ?: rootDir.resolve("../../../specs").canonicalPath
val documents = "src/main/resources/documents"
val bindings = "src/main/kotlin/dev/getmilano/sample/desktop/milanobridge/GeneratedBindings.kt"

val generateMilanoBindings =
    tasks.register<Exec>("generateMilanoBindings") {
        inputs.file("$documents/vocabulary.json")
        inputs.file("$specsDir/tools/generate_bindings.py")
        outputs.file(bindings)
        commandLine(
            "python3",
            "$specsDir/tools/generate_bindings.py",
            "$documents/vocabulary.json",
            "--kotlin-package",
            "dev.getmilano.sample.desktop.milanobridge",
            "--kotlin-out",
            bindings,
        )
    }

// Every bundled document is validated through the reference gate before
// each build: a document the engines would reject fails the build here,
// with the same typed error. Context and state values are synthesized.
val validateMilanoDocuments =
    tasks.register<Exec>("validateMilanoDocuments") {
        inputs.dir(documents)
        outputs.upToDateWhen { false }
        commandLine(
            "sh",
            "-c",
            "for f in $documents/*.json; do " +
                "[ \"$(basename \"${'$'}f\")\" = vocabulary.json ] && continue; " +
                "python3 \"$specsDir/tools/reference_check.py\" --document \"${'$'}f\" " +
                "--vocabulary $documents/vocabulary.json || exit 1; done",
        )
    }

// The vocabulary-specific document schema, for editors and producer CI.
val generateMilanoDocumentSchema =
    tasks.register<Exec>("generateMilanoDocumentSchema") {
        inputs.file("$documents/vocabulary.json")
        outputs.file(rootDir.resolve("documents.schema.json"))
        commandLine(
            "python3",
            "$specsDir/tools/generate_document_schema.py",
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
    implementation("dev.get-milano:engine-compose:1.3.0")

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
            packageVersion = "1.3.0"
            description = "Milano SDK demos"
            vendor = "get-milano.dev"
        }
    }
}
