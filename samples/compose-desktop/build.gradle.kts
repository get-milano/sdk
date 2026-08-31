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

val milanoNodeMissing =
    """
    No Node found. The Milano CLI runs on Node, and these build steps
    generate the typed bindings and the editor schema and validate the
    bundled documents with it.
    Looked on PATH, then in nvm, fnm, volta, asdf, mise, Homebrew, and
    /usr/local. Gradle inherits the environment of whatever started it,
    so an IDE launched from the Dock has a minimal PATH and a Node that
    works in your terminal can still be missing here.
    Name yours to skip the search: MILANO_NODE=/path/to/node.
    """.trimIndent()

/**
 * Node, resolved at execution time rather than left to PATH: see
 * [milanoNodeMissing] for why PATH is not enough. Nothing here is
 * guessed when MILANO_NODE names a binary.
 */
fun milanoNode(): String {
    val home = File(System.getProperty("user.home"))

    fun runnable(candidate: File): File? = candidate.takeIf { it.isFile && it.canExecute() }

    val named = System.getenv("MILANO_NODE")
    if (!named.isNullOrEmpty()) {
        val binary = runnable(File(named))
        checkNotNull(binary) { "MILANO_NODE is set to $named, which is not an executable" }
        return binary.path
    }

    val path = (System.getenv("PATH") ?: "").split(File.pathSeparator)
    val onPath = path.firstNotNullOfOrNull { runnable(File(it, "node")) }
    if (onPath != null) return onPath.path

    // Version managers that install a shim, then the package managers.
    val shims =
        listOf(
            home.resolve(".volta/bin/node"),
            home.resolve(".local/share/mise/shims/node"),
            home.resolve(".asdf/shims/node"),
            File("/opt/homebrew/bin/node"),
            File("/usr/local/bin/node"),
        )
    shims.firstNotNullOfOrNull(::runnable)?.let { return it.path }

    // Managers that keep one directory per installed version. Without a
    // login shell there is no selected version, so take the newest: any
    // Node new enough to run the CLI will do.
    val roots =
        listOf(
            File(System.getenv("NVM_DIR") ?: home.resolve(".nvm").path).resolve("versions/node"),
            home.resolve(".local/share/fnm/node-versions"),
            home.resolve("Library/Application Support/fnm/node-versions"),
        )
    for (root in roots) {
        val versions = root.listFiles()?.sortedBy { it.name.versionKey() } ?: continue
        val newest = versions.lastOrNull() ?: continue
        val inside = listOf(newest.resolve("bin/node"), newest.resolve("installation/bin/node"))
        inside.firstNotNullOfOrNull(::runnable)?.let { return it.path }
    }

    error(milanoNodeMissing)
}

/** Orders `v9.0.0` before `v24.16.0`, which a plain string sort does not. */
fun String.versionKey(): String = removePrefix("v").split(".").joinToString(".") { it.padStart(6, '0') }
val documents = "src/main/resources/documents"
val bindings = "src/main/kotlin/dev/getmilano/sample/desktop/milanobridge/GeneratedBindings.kt"

val generateMilanoBindings =
    tasks.register<Exec>("generateMilanoBindings") {
        inputs.file("$documents/vocabulary.json")
        // The whole bundle, not just the entry point: the generator
        // lives in a sibling file, and tracking bin.js alone leaves the
        // checked-in bindings stale when it changes.
        inputs.dir(file(milanoCli).parentFile)
        outputs.file(bindings)
        doFirst {
            check(file(milanoCli).exists()) { milanoCliMissing }
            // Resolved here, not at configuration time, so a machine
            // without Node can still run unrelated Gradle tasks.
            executable = milanoNode()
        }
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
        doFirst {
            check(file(milanoCli).exists()) { milanoCliMissing }
            // Resolved here, not at configuration time, so a machine
            // without Node can still run unrelated Gradle tasks.
            executable = milanoNode()
        }
        commandLine(
            listOf("node", milanoCli, "validate") + documentFiles +
                listOf("--vocabulary", "$documents/vocabulary.json"),
        )
    }

// The vocabulary-specific document schema, for editors and producer CI.
val generateMilanoDocumentSchema =
    tasks.register<Exec>("generateMilanoDocumentSchema") {
        inputs.file("$documents/vocabulary.json")
        // The whole bundle, not just the entry point: the generator
        // lives in a sibling file, and tracking bin.js alone leaves the
        // checked-in bindings stale when it changes.
        inputs.dir(file(milanoCli).parentFile)
        outputs.file(rootDir.resolve("documents.schema.json"))
        doFirst {
            check(file(milanoCli).exists()) { milanoCliMissing }
            // Resolved here, not at configuration time, so a machine
            // without Node can still run unrelated Gradle tasks.
            executable = milanoNode()
        }
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
    implementation("dev.get-milano:engine-compose:2.1.0")

    implementation(compose.desktop.currentOs)
    implementation(compose.material3)
    // Six icons for the quick actions strip. On Android material3 brings
    // the core icon set along; Compose Multiplatform ships it separately.
    implementation(compose.materialIconsExtended)
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
            packageVersion = "2.1.0"
            description = "Milano SDK demos"
            vendor = "get-milano.dev"
        }
    }
}
