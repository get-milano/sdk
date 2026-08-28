// Repository-level invariants that no single test can see.
//
//   node scripts/check-consistency.mjs
//
// Each check here guards something that has already gone wrong, or that
// would be invisible until a consumer hit it.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
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
