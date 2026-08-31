// Repository-level invariants that no single test can see.
//
//   node scripts/check-consistency.mjs
//
// Each check here guards something that has already gone wrong, or that
// would be invisible until a consumer hit it.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function check(what, verify) {
  try {
    const detail = verify();
    console.log(`ok   ${what}${detail === undefined ? "" : `: ${detail}`}`);
  } catch (error) {
    failures.push(`${what}: ${error instanceof Error ? error.message : String(error)}`);
    console.error(`FAIL ${what}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

function json(path) {
  return JSON.parse(read(path));
}

const VERSION = read("VERSION").trim();

// --- The four samples must render the same documents.
//
// That claim is the point of the samples, and it lives in four
// directories with no link between them.
check("the four samples ship identical documents", () => {
  const sets = {
    "react-native": "samples/react-native/documents",
    swiftui: "samples/swiftui/Resources",
    compose: "samples/compose/app/src/main/assets",
    "compose-desktop": "samples/compose-desktop/src/main/resources/documents",
  };
  const names = readdirSync(join(root, sets["react-native"]))
    .filter((name) => name.endsWith(".json"))
    .sort();
  if (names.length === 0) throw new Error("no documents found to compare");

  const drifted = [];
  for (const name of names) {
    const reference = read(join(sets["react-native"], name));
    for (const [sample, directory] of Object.entries(sets)) {
      if (sample === "react-native") continue;
      let other;
      try {
        other = read(join(directory, name));
      } catch {
        drifted.push(`${name} is missing from ${sample}`);
        continue;
      }
      if (other !== reference) drifted.push(`${name} differs in ${sample}`);
    }
  }
  if (drifted.length > 0) throw new Error(drifted.join("; "));
  return `${names.length} documents, four samples`;
});

// --- The version has to mean the same thing everywhere.
//
// The npm packages once sat at 0.0.0 while VERSION said 1.1.0, and only a
// dry run before a manual publish caught it.
check("the npm packages carry the VERSION", () => {
  const mismatched = [];
  for (const directory of ["engine/ts", "engine/react", "cli"]) {
    const manifest = json(`${directory}/package.json`);
    if (manifest.version !== VERSION) {
      mismatched.push(`${manifest.name} is ${manifest.version}, VERSION is ${VERSION}`);
    }
    for (const [name, range] of Object.entries(manifest.dependencies ?? {})) {
      if (name.startsWith("@get-milano/") && range !== `^${VERSION}`) {
        mismatched.push(`${manifest.name} depends on ${name}@${range}, expected ^${VERSION}`);
      }
    }
  }
  if (mismatched.length > 0) throw new Error(mismatched.join("; "));
  return VERSION;
});

check("the engines carry the development placeholder, not a stamped version", () => {
  // The release stamps these; a stamped value committed to main means a
  // build reports a version it is not.
  const files = {
    "engine/ts/src/core/info.ts": /version: "([^"]+)"/,
    "engine/swiftui/Sources/MilanoSDK/Core/MilanoInfo.swift": /version = "([^"]+)"/,
    "engine/compose/src/commonMain/kotlin/dev/getmilano/core/MilanoInfo.kt": /VERSION: String = "([^"]+)"/,
  };
  const stamped = [];
  for (const [path, pattern] of Object.entries(files)) {
    const found = pattern.exec(read(path))?.[1];
    if (found !== "0.0.0-dev") stamped.push(`${path} reads ${found}`);
  }
  if (stamped.length > 0) throw new Error(stamped.join("; "));
});

// --- The documented install instructions must name the current version.
//
// The Compose sample's dependency line is the same coordinate consumers
// copy, and the composite build substitutes it whatever version it names,
// so it drifted to the previous release without anything failing.
check("the install snippets and the Compose sample name the current version", () => {
  const stale = [];
  const pattern = /(?:engine-compose:|from: ")(\d+\.\d+\.\d+)/g;
  for (const path of ["README.md", "docs/getting-started.md", "samples/compose/app/build.gradle.kts"]) {
    const text = read(path);
    for (const match of text.matchAll(pattern)) {
      if (match[1] !== VERSION) stale.push(`${path} names ${match[1]}`);
    }
  }
  if (stale.length > 0) throw new Error(`${stale.join("; ")}; VERSION is ${VERSION}`);
});

// --- The four sample apps wear the same face.
//
// They are one product shown four ways, so a screenshot of any of them
// should be recognisably the same app. Two carried the real logo while
// the React Native one wore the stock Android robot and Expo's placeholder
// splash for its whole life, because nothing ever compared them.
check("the four samples ship the same app icon and launch image", () => {
  const master = readFileSync(join(root, "samples/assets/app-icon.png"));
  const mark = readFileSync(join(root, "samples/assets/logo-mark.png"));

  // The 1024 masters are copied verbatim, so those compare byte for byte.
  const verbatim = {
    "swiftui app icon":
      "samples/swiftui/Resources/Assets.xcassets/AppIcon.appiconset/icon-1024.png",
    "react-native iOS app icon":
      "samples/react-native/ios/Milano/Images.xcassets/AppIcon.appiconset/App-Icon-1024x1024@1x.png",
    "compose-desktop window icon": "samples/compose-desktop/src/main/resources/app-icon.png",
  };
  const wrong = [];
  for (const [what, path] of Object.entries(verbatim)) {
    if (!readFileSync(join(root, path)).equals(master)) {
      wrong.push(`${what} is not the master in samples/assets/app-icon.png`);
    }
  }

  // The rest are resized, so identity is checked between the two Android
  // apps, which resize to the same ladder from the same source.
  for (const density of ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"]) {
    const compose = `samples/compose/app/src/main/res/mipmap-${density}/ic_launcher.png`;
    const native = `samples/react-native/android/app/src/main/res/mipmap-${density}/ic_launcher.png`;
    if (!readFileSync(join(root, compose)).equals(readFileSync(join(root, native)))) {
      wrong.push(`the two Android launcher icons differ at ${density}`);
    }
  }

  // A launch image everywhere, so no app falls back to a blank window.
  const launches = [
    "samples/swiftui/Resources/Assets.xcassets/LaunchLogo.imageset/launch-logo@3x.png",
    "samples/react-native/ios/Milano/Images.xcassets/SplashScreen.imageset/splashscreen-logo@3x.png",
    "samples/compose/app/src/main/res/drawable-xxxhdpi/splash_logo.png",
    "samples/react-native/android/app/src/main/res/drawable-xxxhdpi/splashscreen_logo.png",
  ];
  for (const path of launches) {
    if (!existsSync(join(root, path))) wrong.push(`no launch image at ${path}`);
  }

  if (wrong.length > 0) throw new Error(wrong.join("; "));
  return `${master.length} byte icon, ${mark.length} byte mark, four apps`;
});

// --- The sample apps carry the version they demonstrate.
//
// Each sample declares its version in its platform's own way, so there is
// no single place to change and they drift apart silently: at the 1.2.0
// bump they read 1.0.0, 1.1.0 and 1.2.0 respectively.
check("the sample apps declare the current version", () => {
  const declarations = {
    "samples/compose/app/build.gradle.kts": /versionName = "([^"]+)"/,
    "samples/compose-desktop/build.gradle.kts": /packageVersion = "([^"]+)"/,
    "samples/swiftui/Project.swift": /"CFBundleShortVersionString": "([^"]+)"/,
    "samples/react-native/app.json": /"version": "([^"]+)"/,
    "samples/react-native/package.json": /"version": "([^"]+)"/,
  };
  const stale = [];
  for (const [path, pattern] of Object.entries(declarations)) {
    const found = pattern.exec(read(path))?.[1];
    if (found !== VERSION) stale.push(`${path} declares ${found ?? "nothing"}`);
  }
  if (stale.length > 0) throw new Error(`${stale.join("; ")}; VERSION is ${VERSION}`);
  return `four samples at ${VERSION}`;
});

// --- The three samples have to be installable side by side.
//
// SwiftUI and Compose can share an identifier, because neither runs on the
// other's platform. The React Native app runs on both, so sharing it means
// installing the samples replaces one another on a device: whoever is
// comparing the three ends up comparing two.
check("the React Native sample has identifiers of its own", () => {
  const native = /bundleId: "([^"]+)"/.exec(read("samples/swiftui/Project.swift"))?.[1];
  const android = /applicationId = "([^"]+)"/
    .exec(read("samples/compose/app/build.gradle.kts"))?.[1];
  const expo = json("samples/react-native/app.json").expo;
  const declared = expo?.ios?.bundleIdentifier;

  // app.json is the source, but the prebuilt ios/ and android/ projects
  // are what actually build and are committed alongside it. Editing only
  // app.json changes nothing until someone reruns `expo prebuild`, so the
  // generated files are checked too rather than trusted to follow.
  const identifiers = {
    "app.json (iOS)": declared,
    "app.json (Android)": expo?.android?.package,
    "ios/Milano.xcodeproj": /PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/
      .exec(read("samples/react-native/ios/Milano.xcodeproj/project.pbxproj"))?.[1],
    "android applicationId": /applicationId '([^']+)'/
      .exec(read("samples/react-native/android/app/build.gradle"))?.[1],
    "android namespace": /namespace '([^']+)'/
      .exec(read("samples/react-native/android/app/build.gradle"))?.[1],
  };

  const problems = [];
  for (const [where, found] of Object.entries(identifiers)) {
    if ([native, android].includes(found)) {
      problems.push(`${where} is ${found}, which a native sample already claims`);
    } else if (found !== declared) {
      problems.push(`${where} is ${found ?? "absent"}, not ${declared}`);
    }
  }
  if (problems.length > 0) throw new Error(problems.join("; "));
  return `${declared}, distinct from ${native}`;
});

// --- React Native decides the React version, and it decides it exactly.
//
// Every react-native ships a renderer compiled against one exact React
// build, and React refuses to run against any other: a patch of drift is
// a hard error at startup ("Incompatible React versions"), not a warning.
// So nothing in this workspace may float `react`. It happened once, from
// the least likely direction: the binding's own test dependency on
// react-test-renderer, whose peer range pulled react a few patches ahead
// of what react-native expected, breaking the sample app but nothing else.
//
// The binding itself is unaffected and stays permissive (`react: >=18`);
// this pins only what we install to develop and test against.
check("nothing floats React away from what react-native needs", () => {
  const rn = json("package-lock.json").packages["node_modules/react-native"];
  if (rn?.peerDependencies?.react === undefined) {
    throw new Error("react-native is not in the lockfile, or no longer declares a react peer");
  }
  // react-native@x declares `^19.2.3`; the base of that range is the
  // build its bundled renderer was compiled against.
  const required = rn.peerDependencies.react.replace(/^[^\d]*/, "");
  const wrong = [];
  const pins = {
    "package.json": ["overrides.react"],
    "engine/react/package.json": ["devDependencies.react", "devDependencies.react-test-renderer"],
    "samples/react-native/package.json": [
      "dependencies.react",
      "devDependencies.react-test-renderer",
    ],
  };
  for (const [path, fields] of Object.entries(pins)) {
    const manifest = json(path);
    for (const field of fields) {
      const [block, name] = field.split(".");
      const found = manifest[block]?.[name];
      if (found !== required) wrong.push(`${path} ${field} is ${found ?? "absent"}`);
    }
  }
  if (wrong.length > 0) {
    throw new Error(`${wrong.join("; ")}; react-native ${rn.version} needs exactly ${required}`);
  }
  return `react ${required}, matching react-native ${rn.version}`;
});

// --- One suite release, everywhere.
//
// The workflows check out the specs at a release tag, and the README says
// which; four places that must agree, or CI tests against one suite while
// the README claims another.
check("the workflows and the README name the same suite release", () => {
  const declared = {};
  for (const workflow of ["ci.yml", "docs.yml", "release.yml"]) {
    const found = /SPECS_RELEASE: "([^"]+)"/.exec(read(`.github/workflows/${workflow}`))?.[1];
    if (found === undefined) throw new Error(`${workflow} declares no SPECS_RELEASE`);
    declared[workflow] = found;
  }
  declared["README.md"] = /held to suite release ([0-9][^ ]*) of the specs/.exec(read("README.md"))?.[1];
  const releases = new Set(Object.values(declared));
  if (releases.size !== 1 || releases.has(undefined)) {
    throw new Error(Object.entries(declared).map(([where, value]) => `${where}: ${value ?? "none"}`).join("; "));
  }
  return `suite release ${[...releases][0]}`;
});

// --- Every engine pins every engine-pinned statement.
//
// The specs' registry (conformance/engine-pinned.json) lists the normative
// statements no vector can express; each applicable engine carries a test
// that names the id. Without this check, a statement pinned in one engine
// and forgotten in another would be a quiet gap, which is what the
// registry exists to prevent.
check("every engine pins the engine-pinned statements", () => {
  const specs = process.env["MILANO_SPECS_DIR"] ?? join(root, "..", "specs");
  const registryPath = join(specs, "conformance", "engine-pinned.json");
  if (!existsSync(registryPath)) {
    throw new Error(`specs checkout not found at ${specs}; set MILANO_SPECS_DIR`);
  }
  const registry = JSON.parse(readFileSync(registryPath, "utf8"));
  const testRoots = {
    swiftui: "engine/swiftui/Tests",
    compose: "engine/compose/src/jvmTest",
    typescript: "engine/ts/test",
  };
  const sources = (directory) =>
    readdirSync(join(root, directory), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => readFileSync(join(entry.parentPath ?? entry.path, entry.name), "utf8"))
      .join("\n");
  const corpus = Object.fromEntries(
    Object.entries(testRoots).map(([runtime, directory]) => [runtime, sources(directory)]),
  );
  const missing = [];
  for (const statement of registry.statements) {
    for (const runtime of statement.applies) {
      if (!corpus[runtime].includes(`engine-pinned: ${statement.id}`)) {
        missing.push(`${runtime} does not pin ${statement.id}`);
      }
    }
  }
  if (missing.length > 0) throw new Error(missing.join("; "));
  return `${registry.statements.length} statements`;
});

// --- The CLI ships the official document schema.
//
// `milano schema` specializes schemas/document.schema.json from the specs,
// and the copy travels in the npm package so producers need no checkout.
// It has to be the specs' bytes, or the CLI would specialize a schema the
// contract no longer has.
check("the CLI's vendored document schema is the specs' own", () => {
  const specs = process.env["MILANO_SPECS_DIR"] ?? join(root, "..", "specs");
  const official = join(specs, "schemas", "document.schema.json");
  if (!existsSync(official)) {
    throw new Error(`specs checkout not found at ${specs}; set MILANO_SPECS_DIR`);
  }
  if (readFileSync(official, "utf8") !== read("cli/schemas/document.schema.json")) {
    throw new Error("cli/schemas/document.schema.json differs from the specs' schemas/document.schema.json; copy it over");
  }
});

// --- The guardrails guide surfaces the specs' detail tables.
//
// The `SchemaViolation` rule table and the occurrence detail table are
// contract, and hosts read them next to the engine docs rather than in
// the specs. A copy drifts, so the names in both tables are compared to
// the specs' own: a rule or a kind in one place and not the other fails.
check("the guardrails guide lists the specs' rules and occurrence kinds", () => {
  const specs = process.env["MILANO_SPECS_DIR"] ?? join(root, "..", "specs");
  const model = join(specs, "01-document-model.md");
  if (!existsSync(model)) {
    throw new Error(`specs checkout not found at ${specs}; set MILANO_SPECS_DIR`);
  }
  const names = (text, header, where) => {
    const start = text.indexOf(header);
    if (start < 0) throw new Error(`${where}: table "${header}" not found`);
    const found = new Set();
    for (const row of text.slice(start).split("\n").slice(2)) {
      if (!row.startsWith("|")) break;
      for (const match of (row.split("|")[1] ?? "").matchAll(/`([^`]+)`/g)) found.add(match[1]);
    }
    return found;
  };
  const guide = read("docs/guardrails.md");
  const compare = (what, expected, actual) => {
    const missing = [...expected].filter((name) => !actual.has(name));
    const extra = [...actual].filter((name) => !expected.has(name));
    if (missing.length > 0 || extra.length > 0) {
      throw new Error(`${what}: missing from the guide: ${missing.join(", ") || "none"}; not in the specs: ${extra.join(", ") || "none"}`);
    }
    return expected.size;
  };
  const rules = compare(
    "rules",
    names(readFileSync(model, "utf8"), "| Rule | Violation |", "specs"),
    names(guide, "| Rule | Violation |", "guardrails.md"),
  );
  const kinds = compare(
    "occurrence kinds",
    names(readFileSync(join(specs, "06-runtime-api.md"), "utf8"), "| Kind | `node` |", "specs"),
    names(guide, "| Kind | `node` |", "guardrails.md"),
  );
  return `${rules} rules, ${kinds} kinds`;
});

// --- Prose style: no em dashes, the rule the specs repository enforces in
// its own CI. Two repositories with one voice should share the rule.
check("the prose holds the no-em-dash rule", () => {
  const files = [
    "README.md",
    "CHANGELOG.md",
    "CONTRIBUTING.md",
    "engine/ts/README.md",
    "engine/react/README.md",
    "cli/README.md",
    "samples/react-native/README.md",
    ...readdirSync(join(root, "docs"))
      .filter((file) => file.endsWith(".md"))
      .map((file) => `docs/${file}`),
  ];
  const offenders = files.filter((path) => read(path).includes("\u2014"));
  if (offenders.length > 0) throw new Error(`em dash in ${offenders.join(", ")}`);
  return `${files.length} files`;
});

// --- Every released version has to have a changelog entry.
//
// Bumping VERSION is the release action, and the changelog is what people
// read before upgrading; the two drifting means a release ships whose
// notes still say "Unreleased", which is worse than having none.
check("the changelog has an entry for the current version", () => {
  const headings = [...read("CHANGELOG.md").matchAll(/^## (.+)$/gm)].map((m) => m[1].trim());
  if (!headings.includes(VERSION)) {
    throw new Error(`no "## ${VERSION}" heading; the changelog starts at "## ${headings[0]}"`);
  }
  return `${headings.length} released versions`;
});

// --- Every sample's generated files match its vocabulary.
//
// Each sample regenerates its bindings and its editor schema before it
// compiles, so a stale committed copy is invisible on a machine that
// builds. CI checked exactly one of them, and only the React Native
// bindings, because that is the one file a CI job happened to regenerate.
// The generators need neither Xcode nor Gradle, only the CLI, so the
// honest check is to run them here and compare bytes: it covers all four
// samples whether or not anything built them.
check("every sample's generated bindings and schema match its vocabulary", () => {
  const cli = join(root, "cli", "dist", "bin.js");
  if (!existsSync(cli)) {
    throw new Error(`the CLI is not built at ${cli}: run \`npm run build\` at the repository root`);
  }
  const samples = [
    {
      name: "react-native",
      vocabulary: "samples/react-native/documents/vocabulary.json",
      schema: null, // The React Native sample ships no editor schema.
      bindings: "samples/react-native/src/bindings.generated.ts",
      flags: ["--ts-prefix", "Sample", "--ts-out"],
    },
    {
      name: "swiftui",
      vocabulary: "samples/swiftui/Resources/vocabulary.json",
      schema: "samples/swiftui/documents.schema.json",
      bindings: "samples/swiftui/Sources/MilanoBridge/GeneratedBindings.swift",
      flags: ["--swift-prefix", "Sample", "--swift-out"],
    },
    {
      name: "compose",
      vocabulary: "samples/compose/app/src/main/assets/vocabulary.json",
      schema: "samples/compose/documents.schema.json",
      bindings:
        "samples/compose/app/src/main/kotlin/dev/getmilano/sample/milanobridge/GeneratedBindings.kt",
      flags: ["--kotlin-package", "dev.getmilano.sample.milanobridge", "--kotlin-out"],
    },
    {
      name: "compose-desktop",
      vocabulary: "samples/compose-desktop/src/main/resources/documents/vocabulary.json",
      schema: "samples/compose-desktop/documents.schema.json",
      bindings:
        "samples/compose-desktop/src/main/kotlin/dev/getmilano/sample/desktop/milanobridge/GeneratedBindings.kt",
      flags: ["--kotlin-package", "dev.getmilano.sample.desktop.milanobridge", "--kotlin-out"],
    },
  ];

  const scratch = mkdtempSync(join(tmpdir(), "milano-generated-"));
  const stale = [];
  for (const sample of samples) {
    const vocabulary = join(root, sample.vocabulary);

    const bindings = join(scratch, `${sample.name}-bindings`);
    execFileSync("node", [cli, "bindings", vocabulary, ...sample.flags, bindings], {
      cwd: root,
      encoding: "utf8",
    });
    if (readFileSync(bindings, "utf8") !== read(sample.bindings)) {
      stale.push(`${sample.name}: ${sample.bindings}`);
    }

    if (sample.schema === null) continue;
    const schema = join(scratch, `${sample.name}-schema.json`);
    execFileSync("node", [cli, "schema", vocabulary, "--out", schema], {
      cwd: root,
      encoding: "utf8",
    });
    if (readFileSync(schema, "utf8") !== read(sample.schema)) {
      stale.push(`${sample.name}: ${sample.schema}`);
    }
  }
  if (stale.length > 0) {
    throw new Error(`regenerate from the vocabulary: ${stale.join("; ")}`);
  }
  return `${samples.length} samples, bindings and schema as generated`;
});

// --- One React in the sample's resolution scope.
//
// Two copies is a crash on the first hook, not a warning: an app that
// resolves a different React than the one react-native bound to fails at
// runtime. Metro used to be told `disableHierarchicalLookup` to guarantee
// this, but that flag also stops it looking inside a package's own
// node_modules, where npm legitimately nests what it cannot hoist, and
// the sample stopped bundling at all. The guarantee belongs here, where a
// second copy is a failed build rather than a resolver rule that breaks
// unrelated packages.
check("the React Native sample resolves one React", () => {
  const roots = [
    join(root, "samples", "react-native", "node_modules"),
    join(root, "node_modules"),
  ];
  const found = [];
  for (const modules of roots) {
    if (!existsSync(modules)) continue;
    // Hoisted copies, plus any a package nested under itself.
    const nested = readdirSync(modules)
      .filter((name) => !name.startsWith("."))
      .map((name) => join(modules, name, "node_modules", "react", "package.json"));
    for (const path of [join(modules, "react", "package.json"), ...nested]) {
      if (existsSync(path)) found.push(path);
    }
  }
  if (found.length !== 1) {
    throw new Error(
      found.length === 0
        ? "no React found: run npm ci at the repository root"
        : `${found.length} copies of React: ${found.join(", ")}`,
    );
  }
  return `one React, at ${found[0].slice(root.length + 1)}`;
});

// --- The React Native sample bundles its documents as text.
//
// `documents.generated.ts` is what the app actually renders: the JSON
// files beside it are only its source. Nothing regenerated it in CI and
// nothing compared the two, so an edited document could ship as the old
// text, and the sample's own render smoke test would keep passing against
// the stale copy. That happened, twice, before this check existed.
check("the React Native sample's bundled documents match the JSON", () => {
  const sample = join(root, "samples", "react-native");
  const bundled = read("samples/react-native/src/documents.generated.ts");
  const names = readdirSync(join(sample, "documents"))
    .filter((name) => name.endsWith(".json"))
    .sort();

  const stale = [];
  for (const name of names) {
    const text = readFileSync(join(sample, "documents", name), "utf8").trimEnd();
    const key = JSON.stringify(name.replace(/\.json$/, ""));
    const entry = `  ${key}: ${JSON.stringify(text)},`;
    if (!bundled.includes(entry)) stale.push(name);
  }
  // A document deleted from disk but left in the bundle is the same drift
  // in the other direction, and the count is what catches it.
  const bundledCount = (bundled.match(/^  "/gm) ?? []).length;
  if (bundledCount !== names.length) {
    stale.push(`the bundle holds ${bundledCount} documents, the directory ${names.length}`);
  }
  if (stale.length > 0) {
    throw new Error(`${stale.join("; ")}: run \`npm run documents\` in samples/react-native`);
  }
  return `${names.length} documents, bundled as written`;
});

// --- The quick start's document is written into four host files.
//
// Every other document the samples render is one file copied to four
// places, and the check above keeps those honest. The quick start's is
// inline in Swift, Kotlin, Kotlin, and TypeScript, because its whole point
// is that a document can be two strings in code. That put it outside every
// validator: it had already drifted (one copy declared contract 1.0 while
// the others declared 2.0), and a document that the gate would reject
// would have shipped as a broken first impression.
check("the four quick starts embed the same, valid document", () => {
  const sources = {
    swiftui: "samples/swiftui/Sources/Screens/QuickStartScreen.swift",
    compose: "samples/compose/app/src/main/kotlin/dev/getmilano/sample/ui/screens/QuickStartScreen.kt",
    "compose-desktop":
      "samples/compose-desktop/src/main/kotlin/dev/getmilano/sample/desktop/ui/screens/QuickStartScreen.kt",
    "react-native": "samples/react-native/src/screens/QuickStartScreen.tsx",
  };

  /** Every balanced `{...}` in the source that parses as JSON. */
  function embeddedJson(source) {
    // Kotlin writes a literal `$` as `${'$'}` inside a raw string.
    const text = source.replaceAll("${'$'}", "$");
    const found = [];
    for (let start = 0; start < text.length; start += 1) {
      if (text[start] !== "{") continue;
      let depth = 0;
      let inString = false;
      for (let at = start; at < text.length; at += 1) {
        const character = text[at];
        if (inString) {
          if (character === "\\") at += 1;
          else if (character === '"') inString = false;
          continue;
        }
        if (character === '"') inString = true;
        else if (character === "{") depth += 1;
        else if (character === "}") {
          depth -= 1;
          if (depth > 0) continue;
          try {
            found.push(JSON.parse(text.slice(start, at + 1)));
            start = at;
          } catch {
            // Not JSON: ordinary source braces, skipped.
          }
          break;
        }
      }
    }
    return found;
  }

  /** Key order is a formatting choice; compare the shapes. */
  function stable(value) {
    if (Array.isArray(value)) return value.map(stable);
    if (value === null || typeof value !== "object") return value;
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }

  const pairs = {};
  for (const [sample, path] of Object.entries(sources)) {
    const objects = embeddedJson(read(path));
    const vocabulary = objects.find((object) => object["milano"] !== undefined);
    const document = objects.find((object) => object["root"] !== undefined);
    if (vocabulary === undefined || document === undefined) {
      throw new Error(`${sample}: no inline vocabulary and document found in ${path}`);
    }
    pairs[sample] = { vocabulary, document };
  }

  const [reference, ...others] = Object.keys(pairs);
  for (const sample of others) {
    for (const part of ["vocabulary", "document"]) {
      const mine = JSON.stringify(stable(pairs[sample][part]));
      const theirs = JSON.stringify(stable(pairs[reference][part]));
      if (mine !== theirs) {
        throw new Error(`${sample}'s quick start ${part} differs from ${reference}'s`);
      }
    }
  }

  // The gate is the only judge of whether a document is valid, so run the
  // real one: the same CLI the samples validate their bundled documents with.
  const cli = join(root, "cli", "dist", "bin.js");
  if (!existsSync(cli)) {
    throw new Error(`the CLI is not built at ${cli}: run \`npm run build\` at the repository root`);
  }
  const scratch = mkdtempSync(join(tmpdir(), "milano-quickstart-"));
  const vocabularyPath = join(scratch, "vocabulary.json");
  const documentPath = join(scratch, "quick-start.json");
  writeFileSync(vocabularyPath, JSON.stringify(pairs[reference].vocabulary, null, 2));
  writeFileSync(documentPath, JSON.stringify(pairs[reference].document, null, 2));
  execFileSync("node", [cli, "validate", documentPath, "--vocabulary", vocabularyPath], {
    cwd: root,
    encoding: "utf8",
  });
  return "four samples, one document, valid against its vocabulary";
});

// --- Generated bindings have to survive the formatters that read them.
//
// The Swift is linted by SwiftLint (130 columns) and the Kotlin by ktlint,
// but ktlint does not measure KDoc lines and nothing at all checks the
// generated TypeScript. That blind spot shipped a 229-column comment and a
// 280-column decode line. The generator wraps both now; this keeps it that
// way, in every language and for the specs' goldens too.
check("generated bindings stay inside the line limit", () => {
  const LIMIT = 130;
  const generated = [
    "samples/swiftui/Sources/MilanoBridge/GeneratedBindings.swift",
    "samples/compose/app/src/main/kotlin/dev/getmilano/sample/milanobridge/GeneratedBindings.kt",
    "samples/compose-desktop/src/main/kotlin/dev/getmilano/sample/desktop/milanobridge/GeneratedBindings.kt",
    "samples/react-native/src/bindings.generated.ts",
  ].map((path) => join(root, path));
  const specs = process.env["MILANO_SPECS_DIR"] ?? join(root, "..", "specs");
  for (const name of ["expected_bindings.swift", "expected_bindings.kt", "expected_bindings.ts"]) {
    const golden = join(specs, "tools", "testdata", name);
    if (existsSync(golden)) generated.push(golden);
  }

  const offenders = [];
  for (const path of generated) {
    if (!existsSync(path)) throw new Error(`missing generated file: ${path}`);
    readFileSync(path, "utf8")
      .split("\n")
      .forEach((line, index) => {
        if (line.length > LIMIT) {
          offenders.push(`${path.split("/").pop()}:${index + 1} is ${line.length} columns`);
        }
      });
  }
  if (offenders.length > 0) {
    throw new Error(`${offenders.length} over ${LIMIT} columns: ${offenders.slice(0, 3).join("; ")}`);
  }
  return `${generated.length} files, none over ${LIMIT} columns`;
});

// --- What we publish carries no third-party code.
//
// "No dependencies" is a claim the README makes and a reason people adopt
// this: an engine that pulls nothing cannot inherit anyone's advisory, and
// the sample toolchains' advisories (Expo, Metro) stay where they are,
// outside everything published. It is one line in a package.json away from
// being untrue, so it is checked rather than remembered. The same check
// keeps the metadata npm renders from going missing again.
check("the published packages carry no third-party runtime dependencies", () => {
  const published = ["engine/ts", "engine/react", "cli"];
  const problems = [];
  for (const directory of published) {
    const manifest = json(`${directory}/package.json`);
    for (const [name, range] of Object.entries(manifest.dependencies ?? {})) {
      if (!name.startsWith("@get-milano/")) {
        problems.push(`${manifest.name} depends on ${name}@${range}`);
      }
    }
    for (const field of ["license", "repository", "homepage", "bugs", "engines", "files"]) {
      if (manifest[field] === undefined) problems.push(`${manifest.name} declares no ${field}`);
    }
  }
  if (problems.length > 0) throw new Error(problems.join("; "));
  return `${published.length} packages, ${published.length} manifests complete`;
});

// --- What we publish has to be installable.
//
// `npm pack` shows a file list; nothing until now ran what was inside it.
// A broken `exports` map or a missing entry in `files` would ship.
check("the packed tarballs install and import", () => {
  const output = execFileSync(
    "node",
    [join(root, "scripts", "verify-package.mjs")],
    { cwd: root, encoding: "utf8" },
  );
  return output.trim().split("\n").pop();
});

console.log();
if (failures.length > 0) {
  console.error(`${failures.length} consistency check(s) failed`);
  process.exit(1);
}
console.log("every consistency check passed");
