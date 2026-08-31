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
        versionName = "2.1.0"
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

val generateMilanoBindings =
    tasks.register<Exec>("generateMilanoBindings") {
        inputs.file("src/main/assets/vocabulary.json")
        // The whole bundle, not just the entry point: the generator
        // lives in a sibling file, and tracking bin.js alone leaves the
        // checked-in bindings stale when it changes.
        inputs.dir(file(milanoCli).parentFile)
        outputs.file("src/main/kotlin/dev/getmilano/sample/milanobridge/GeneratedBindings.kt")
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
        doFirst {
            check(file(milanoCli).exists()) { milanoCliMissing }
            // Resolved here, not at configuration time, so a machine
            // without Node can still run unrelated Gradle tasks.
            executable = milanoNode()
        }
        commandLine(
            listOf("node", milanoCli, "validate") + documentFiles +
                listOf("--vocabulary", "src/main/assets/vocabulary.json"),
        )
    }

// The vocabulary-specific document schema, for editors and producer CI.
val generateMilanoDocumentSchema =
    tasks.register<Exec>("generateMilanoDocumentSchema") {
        inputs.file("src/main/assets/vocabulary.json")
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
    implementation("dev.get-milano:engine-compose:2.1.0")

    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.compose.material3:material3:1.3.1")
    // The eye pair the card detail's reveal control draws. material3
    // brings the core icon set along; these two are in the extended one,
    // as they are for the Compose Desktop sample.
    implementation("androidx.compose.material:material-icons-extended:1.7.8")
    implementation("io.coil-kt:coil-compose:2.7.0")
}
