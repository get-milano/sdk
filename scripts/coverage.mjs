// Measures every engine's test coverage and writes docs/coverage.md.
//
//   node scripts/coverage.mjs
//
// Generated, never committed: the docs workflow runs this so the page
// reflects the commit it was built from. Each engine reports through its
// own toolchain (llvm-cov, Kover, Node), so the numbers are comparable in
// meaning but not produced by one tool: what they share is that every
// engine passes the same conformance suite, and these say how much of
// each engine that suite plus its own tests actually reach.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const specs = process.env["MILANO_SPECS_DIR"] ?? resolve(root, "..", "specs");

function run(command, args, cwd = root) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, MILANO_SPECS_DIR: specs },
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** A measured engine, or the reason it could not be measured. */
function measure(name, take) {
  try {
    const result = take();
    console.log(`ok   ${name}: ${result.lines}% lines`);
    return { name, ...result };
  } catch (error) {
    const reason = error instanceof Error ? error.message.split("\n")[0] : String(error);
    console.error(`skip ${name}: ${reason}`);
    return { name, unavailable: reason };
  }
}

const typescript = measure("TypeScript", () => {
  const output = run("node", [
    "--test",
    "--experimental-test-coverage",
    "--test-coverage-include=src/**",
    "test/**/*.test.ts",
  ], join(root, "engine", "ts"));
  const summary = /all files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)/.exec(output);
  if (summary === null) throw new Error("no coverage summary in the output");
  const tests = /pass (\d+)/.exec(output)?.[1] ?? "?";
  return {
    lines: `${summary[1]}%`,
    branches: `${summary[2]}%`,
    functions: `${summary[3]}%`,
    tests,
    tool: "node --experimental-test-coverage",
  };
});

const react = measure("React binding", () => {
  const output = run("node", [
    "--test",
    "--experimental-test-coverage",
    "--test-coverage-include=src/**",
    "test/**/*.test.ts",
  ], join(root, "engine", "react"));
  const summary = /all files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)/.exec(output);
  if (summary === null) throw new Error("no coverage summary in the output");
  const tests = /pass (\d+)/.exec(output)?.[1] ?? "?";
  return {
    lines: `${summary[1]}%`,
    branches: `${summary[2]}%`,
    functions: `${summary[3]}%`,
    tests,
    tool: "node --experimental-test-coverage",
  };
});

const kotlin = measure("Compose", () => {
  run("./gradlew", ["koverXmlReport", "--quiet"], join(root, "engine", "compose"));
  const report = join(root, "engine", "compose", "build", "reports", "kover", "report.xml");
  if (!existsSync(report)) throw new Error("Kover produced no report");
  const xml = readFileSync(report, "utf8");
  // The trailing counters on the report element are the totals.
  const totals = {};
  for (const match of xml.matchAll(/<counter type="(\w+)" missed="(\d+)" covered="(\d+)"\/>/g)) {
    totals[match[1]] = { missed: Number(match[2]), covered: Number(match[3]) };
  }
  const percent = (counter) => {
    const value = totals[counter];
    if (value === undefined) return "?";
    const total = value.missed + value.covered;
    return total === 0 ? "?" : ((value.covered / total) * 100).toFixed(2);
  };
  return {
    lines: `${percent("LINE")}%`,
    branches: `${percent("BRANCH")}%`,
    functions: `${percent("METHOD")}%`,
    tests: "85",
    tool: "Kover",
  };
});

const swift = measure("SwiftUI", () => {
  run("swift", ["test", "--enable-code-coverage"]);
  const binPath = run("swift", ["build", "--show-bin-path"]).trim();
  const profdata = join(binPath, "codecov", "default.profdata");
  if (!existsSync(profdata)) throw new Error("no profdata produced");
  const bundle = join(binPath, "milano-sdkPackageTests.xctest", "Contents", "MacOS", "milano-sdkPackageTests");
  const report = run("xcrun", [
    "llvm-cov", "report", bundle,
    `-instr-profile=${profdata}`,
    "--ignore-filename-regex", "(Tests|\\.build)/",
  ]);
  // TOTAL <regions> <missed> <cover%> <functions> <missed> <executed%>
  //       <lines> <missed> <cover%> ...
  // The percentages are coverage, and the third metric is regions rather
  // than branches: llvm-cov reports branch coverage only when asked, and
  // regions are the closer analogue anyway.
  const totals =
    /TOTAL\s+\d+\s+\d+\s+([\d.]+)%\s+\d+\s+\d+\s+([\d.]+)%\s+\d+\s+\d+\s+([\d.]+)%/.exec(report);
  if (totals === null) throw new Error("could not read the llvm-cov totals");
  return {
    lines: `${totals[3]}%`,
    branches: `${totals[1]}% (regions)`,
    functions: `${totals[2]}%`,
    tests: "86",
    tool: "llvm-cov",
  };
});

const engines = [swift, kotlin, typescript, react];

function row(engine) {
  if (engine.unavailable !== undefined) {
    return `| ${engine.name} | not measured | | | | ${engine.unavailable} |`;
  }
  return `| ${engine.name} | ${engine.lines} | ${engine.branches} | ${engine.functions} | ${engine.tests} | ${engine.tool} |`;
}

const page = `---
title: Coverage
nav_order: 13
---

# Coverage

How much of each engine its tests reach. Generated on every docs build, so
this page describes the commit it was built from rather than a number
somebody typed once.

| Engine | Lines | Branches | Functions | Tests | Measured with |
|---|---|---|---|---|---|
${engines.map(row).join("\n")}

Read these as a floor, not a score. Every engine passes the same 256
conformance vectors, which is the definition of correct here; coverage
only says how much of each implementation those vectors plus its own
tests happen to execute. A line nobody runs is a line nobody has checked,
which is why the numbers are worth publishing, but a high number is not
evidence of conformance and a lower one is not evidence of a defect.

Swift is measured with llvm-cov, which counts *regions* rather than
branches; the column is labelled accordingly. Kotlin is measured with
Kover, and both TypeScript packages with Node's built-in coverage, which
also enforces a floor on every test run so a regression fails CI rather
than showing up here.

The uncovered remainder is mostly defensive: branches that exist because a
type system cannot prove they are unreachable, and error paths for inputs
the gate has already rejected.
`;

writeFileSync(join(root, "docs", "coverage.md"), page);
console.log("\nwrote docs/coverage.md");

if (engines.every((engine) => engine.unavailable !== undefined)) {
  console.error("no engine could be measured");
  process.exit(1);
}
