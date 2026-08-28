import { readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { MilanoEngineError, MilanoJsonError, parseJson } from "@get-milano/core";
import type { MilanoUnknownTypePolicy, MilanoValue } from "@get-milano/core";

import { BindingError, defaultPrefix, generateKotlin, generateSwift, generateTs } from "./bindings.ts";
import { report as diffReport } from "./diff.ts";
import { identifierFrom, scaffold } from "./init.ts";
import { renderSchema } from "./schema.ts";
import { validate } from "./validate.ts";
import type { ValidationReport } from "./validate.ts";

/** What the command line touches, injectable so the tests need no process. */
export interface CliIo {
  readonly readFile: (path: string) => Promise<string>;
  readonly writeFile: (path: string, text: string) => Promise<void>;
  readonly exists: (path: string) => Promise<boolean>;
  /** Creates the directory and its parents; no error when it exists. */
  readonly mkdir: (path: string) => Promise<void>;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

const USAGE = `usage: milano <command> [options]

commands:
  init       scaffold a producer folder: vocabulary, first document, schema, scripts
  validate   run documents through the gate the engines run
  schema     specialize the document schema to a vocabulary, for editors and CI
  diff       classify the changes between two versions of a vocabulary
  bindings   generate typed Swift, Kotlin, and TypeScript bindings from a vocabulary

milano <command> --help shows the command's options.
  -h, --help                   this text
      --version                the CLI's version
`;

const INIT_USAGE = `usage: milano init [directory] [options]

Scaffolds a producer folder: a starter vocabulary, a first document that
uses every part of it, the editor schema and the settings that point at
it, a package.json whose scripts run this CLI, and a README. Nothing that
already exists is overwritten unless --force is passed.

options:
      --name <identifier>      the vocabulary's name (default: from the
                               directory's name)
      --force                  overwrite files that exist
  -h, --help                   this text

exit status:
  0  the folder was written
  1  a file would be overwritten (nothing was written)
  2  usage
`;

const VALIDATE_USAGE = `usage: milano validate <document>... --vocabulary <file> [options]

Runs each document through the full gate the engines run and reports the
same typed error an engine would throw.

options:
  -v, --vocabulary <file>      the vocabulary artifact (required)
      --context <file>         JSON file of context values; declared keys it
                               omits are synthesized as zero-values
      --state <file>           JSON file of state values, likewise
      --unknown-types <policy> fail (default), skip, or placeholder
      --json                   one JSON report per document on stdout
  -h, --help                   this text

exit status:
  0  every document is valid
  1  at least one document was rejected
  2  usage, an unreadable file, or an invalid vocabulary
`;

const SCHEMA_USAGE = `usage: milano schema <vocabulary> [--out <file>]

Specializes the official document schema to the vocabulary: component types
become an enum, properties get typed value schemas, event names constrain
\`on\`. Commit the output next to your documents and point your editor and
CI at it.

options:
      --out <file>             where to write the schema; standard output
                               when omitted
  -h, --help                   this text

exit status:
  0  the schema was written
  2  usage, or an unreadable vocabulary
`;

const DIFF_USAGE = `usage: milano diff <old-vocabulary> <new-vocabulary>

Classifies every change between two versions of a vocabulary as ADDITIVE
or BREAKING per the evolution rules, and checks that the version bump
matches: additive changes need at least a minor bump, breaking ones a
major. Run it in CI before publishing a vocabulary.

options:
  -h, --help                   this text

exit status:
  0  the version bump matches the changes
  1  it does not (the problems are on stderr)
  2  usage, or an unreadable vocabulary
`;

const BINDINGS_USAGE = `usage: milano bindings <vocabulary> [options]

Generates compiler-checked bindings from the vocabulary: node wrappers with
typed accessors, typed event emitters, an exhaustive action type, and a
vocabulary identity helper. Pass at least one output; each language is
optional. Output is deterministic: same vocabulary and flags, same bytes.

options:
      --swift-out <file>       Swift output file
      --swift-prefix <name>    type prefix for Swift (default: the
                               capitalized vocabulary name)
      --kotlin-out <file>      Kotlin output file
      --kotlin-package <name>  Kotlin package (required with --kotlin-out)
      --kotlin-prefix <name>   type prefix for Kotlin (default: none)
      --ts-out <file>          TypeScript output file
      --ts-prefix <name>       type prefix for TypeScript (default: the
                               capitalized vocabulary name)
      --ts-core-import <name>  module the TypeScript file imports
                               MilanoValue from (default: @get-milano/core)
  -h, --help                   this text

exit status:
  0  every requested file was written
  1  the vocabulary cannot be bound (an enum whose members collide)
  2  usage, or an unreadable vocabulary
`;

const POLICIES: readonly MilanoUnknownTypePolicy[] = ["fail", "skip", "placeholder"];

class UsageError extends Error {}

/** A file that could not be read or parsed as the command expects. */
class InputError extends Error {}

const HELP = { help: { type: "boolean", short: "h" } } as const;

const VALIDATE_OPTIONS = {
  ...HELP,
  vocabulary: { type: "string", short: "v" },
  context: { type: "string" },
  state: { type: "string" },
  "unknown-types": { type: "string" },
  json: { type: "boolean" },
} as const;

const SCHEMA_OPTIONS = { ...HELP, out: { type: "string" } } as const;

const INIT_OPTIONS = { ...HELP, name: { type: "string" }, force: { type: "boolean" } } as const;

const DIFF_OPTIONS = HELP;

const BINDINGS_OPTIONS = {
  ...HELP,
  "swift-out": { type: "string" },
  "swift-prefix": { type: "string" },
  "kotlin-out": { type: "string" },
  "kotlin-package": { type: "string" },
  "kotlin-prefix": { type: "string" },
  "ts-out": { type: "string" },
  "ts-prefix": { type: "string" },
  "ts-core-import": { type: "string" },
} as const;

function version(): string {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    version: string;
  };
  return manifest.version;
}

async function readValues(
  io: CliIo,
  path: string,
  what: string,
): Promise<Readonly<Record<string, MilanoValue>>> {
  const values = parseJson(await io.readFile(path)).recordValue;
  if (values === null) throw new UsageError(`${path}: ${what} values must be a JSON object`);
  return values;
}

/** A vocabulary artifact as plain JSON: what the specs tools read with `json.load`. */
async function readArtifact(io: CliIo, path: string): Promise<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await io.readFile(path));
  } catch (error) {
    if (error instanceof SyntaxError) throw new InputError(`${path}: ${error.message}`);
    throw error;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new InputError(`${path}: a vocabulary artifact is a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

function describeOccurrence(occurrence: ValidationReport["occurrences"][number]): string {
  let line = `  ${occurrence.kind}`;
  if (occurrence.node !== null) line += ` at ${occurrence.node}`;
  if (occurrence.name !== null) line += ` (${occurrence.name})`;
  if (occurrence.expected !== null || occurrence.found !== null) {
    line += `: expected ${occurrence.expected ?? "-"}, found ${occurrence.found ?? "-"}`;
  }
  return line;
}

/** The command line, returning the exit status rather than exiting. */
export async function main(argv: readonly string[], io: CliIo): Promise<number> {
  try {
    return await run(argv, io);
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr(`milano: ${error.message}\n`);
      if (error.message.startsWith("usage")) io.stderr(USAGE);
      return 2;
    }
    if (error instanceof InputError || error instanceof MilanoEngineError || error instanceof MilanoJsonError) {
      io.stderr(`milano: ${error.message}\n`);
      return 2;
    }
    if (error instanceof BindingError) {
      io.stderr(`milano: ${error.message}\n`);
      return 1;
    }
    if (error instanceof Error && "code" in error && typeof error.code === "string") {
      // A file the host could not read: ENOENT, EACCES, EISDIR.
      io.stderr(`milano: ${error.message}\n`);
      return 2;
    }
    throw error;
  }
}

/** `parseArgs` with its complaints (an unknown option, a missing value) as usage errors. */
function parsed<T>(parse: () => T): T {
  try {
    return parse();
  } catch (error) {
    throw new UsageError(`usage: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function run(argv: readonly string[], io: CliIo): Promise<number> {
  const [command, ...rest] = argv;
  if (command === undefined || command === "-h" || command === "--help") {
    if (command === undefined) throw new UsageError("usage: a command is required");
    io.stdout(USAGE);
    return 0;
  }
  if (command === "--version") {
    io.stdout(`milano ${version()}\n`);
    return 0;
  }
  switch (command) {
    case "init":
      return runInit(rest, io);
    case "validate":
      return runValidate(rest, io);
    case "schema":
      return runSchema(rest, io);
    case "diff":
      return runDiff(rest, io);
    case "bindings":
      return runBindings(rest, io);
    default:
      throw new UsageError(`usage: unknown command ${command}`);
  }
}

async function runInit(argv: readonly string[], io: CliIo): Promise<number> {
  const { values, positionals } = parsed(() => parseArgs({ args: [...argv], options: INIT_OPTIONS, allowPositionals: true }));
  if (values.help === true) {
    io.stdout(INIT_USAGE);
    return 0;
  }
  const [directory = ".", ...extra] = positionals;
  if (extra.length > 0) throw new UsageError(`usage: init takes one directory, got ${positionals.length}`);
  const name = values.name ?? identifierFrom(basename(resolve(directory)));
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) {
    throw new UsageError(`usage: --name must be an identifier ([A-Za-z][A-Za-z0-9_]*), got ${name}`);
  }

  const files = scaffold(name, version()).map((file) => ({ ...file, target: join(directory, file.path) }));
  if (values.force !== true) {
    const existing: string[] = [];
    for (const file of files) if (await io.exists(file.target)) existing.push(file.target);
    if (existing.length > 0) {
      for (const path of existing) io.stderr(`milano: ${path} exists; pass --force to overwrite\n`);
      return 1;
    }
  }
  for (const file of files) {
    await io.mkdir(dirname(file.target));
    await io.writeFile(file.target, file.text);
    io.stdout(`created ${file.target}\n`);
  }
  const enter = directory === "." ? "" : `cd ${directory} && `;
  io.stdout(`\nnext: ${enter}npm install && npm run check\n`);
  return 0;
}

async function runValidate(argv: readonly string[], io: CliIo): Promise<number> {
  const { values, positionals: documents } = parsed(() => parseArgs({ args: [...argv], options: VALIDATE_OPTIONS, allowPositionals: true }));
  if (values.help === true) {
    io.stdout(VALIDATE_USAGE);
    return 0;
  }
  if (documents.length === 0) throw new UsageError("usage: validate needs at least one document");
  if (values.vocabulary === undefined) throw new UsageError("usage: --vocabulary is required");

  const policy = values["unknown-types"] ?? "fail";
  if (!POLICIES.includes(policy as MilanoUnknownTypePolicy)) {
    throw new UsageError(`usage: --unknown-types must be one of ${POLICIES.join(", ")}, got ${policy}`);
  }

  const vocabulary = await io.readFile(values.vocabulary);
  const context = values.context === undefined ? {} : await readValues(io, values.context, "context");
  const state = values.state === undefined ? {} : await readValues(io, values.state, "state");

  const reports: { file: string; report: ValidationReport }[] = [];
  for (const file of documents) {
    const document = await io.readFile(file);
    const report = await validate({
      document,
      vocabulary,
      context,
      state,
      unknownTypes: policy as MilanoUnknownTypePolicy,
    });
    reports.push({ file, report });
  }

  if (values.json === true) {
    const output = reports.map(({ file, report }) => ({ file, ...report }));
    io.stdout(`${JSON.stringify(output, null, 2)}\n`);
  } else {
    for (const { file, report } of reports) {
      for (const warning of report.warnings) io.stderr(`${file}: warning: ${warning}\n`);
      if (report.valid) {
        io.stdout(`${file}: valid\n`);
        for (const occurrence of report.occurrences) io.stdout(`${describeOccurrence(occurrence)}\n`);
      } else {
        io.stderr(`${file}: ${report.error?.type}: ${report.error?.message}\n`);
      }
    }
  }
  return reports.every(({ report }) => report.valid) ? 0 : 1;
}

async function runSchema(argv: readonly string[], io: CliIo): Promise<number> {
  const { values, positionals } = parsed(() => parseArgs({ args: [...argv], options: SCHEMA_OPTIONS, allowPositionals: true }));
  if (values.help === true) {
    io.stdout(SCHEMA_USAGE);
    return 0;
  }
  const [path, ...extra] = positionals;
  if (path === undefined) throw new UsageError("usage: schema needs the vocabulary");
  if (extra.length > 0) throw new UsageError(`usage: schema takes one vocabulary, got ${positionals.length}`);

  const text = renderSchema(await readArtifact(io, path));
  if (values.out === undefined) {
    io.stdout(text);
  } else {
    await io.writeFile(values.out, text);
    io.stdout(`generated ${values.out}\n`);
  }
  return 0;
}

async function runDiff(argv: readonly string[], io: CliIo): Promise<number> {
  const { values, positionals } = parsed(() => parseArgs({ args: [...argv], options: DIFF_OPTIONS, allowPositionals: true }));
  if (values.help === true) {
    io.stdout(DIFF_USAGE);
    return 0;
  }
  const [oldPath, newPath, ...extra] = positionals;
  if (oldPath === undefined || newPath === undefined || extra.length > 0) {
    throw new UsageError("usage: diff takes the old and the new vocabulary");
  }

  const result = diffReport(await readArtifact(io, oldPath), await readArtifact(io, newPath));
  io.stdout(result.stdout);
  io.stderr(result.stderr);
  return result.status;
}

async function runBindings(argv: readonly string[], io: CliIo): Promise<number> {
  const { values, positionals } = parsed(() => parseArgs({ args: [...argv], options: BINDINGS_OPTIONS, allowPositionals: true }));
  if (values.help === true) {
    io.stdout(BINDINGS_USAGE);
    return 0;
  }
  const [path, ...extra] = positionals;
  if (path === undefined) throw new UsageError("usage: bindings needs the vocabulary");
  if (extra.length > 0) throw new UsageError(`usage: bindings takes one vocabulary, got ${positionals.length}`);
  if (values["kotlin-out"] !== undefined && values["kotlin-package"] === undefined) {
    throw new UsageError("--kotlin-out requires --kotlin-package");
  }
  if (values["swift-out"] === undefined && values["kotlin-out"] === undefined && values["ts-out"] === undefined) {
    throw new UsageError("nothing to do: pass --swift-out, --kotlin-out and/or --ts-out");
  }

  const vocabulary = await readArtifact(io, path);
  const wrote: string[] = [];
  if (values["swift-out"] !== undefined) {
    await io.writeFile(values["swift-out"], generateSwift(vocabulary, values["swift-prefix"] ?? defaultPrefix(vocabulary)));
    wrote.push(values["swift-out"]);
  }
  if (values["kotlin-out"] !== undefined) {
    await io.writeFile(
      values["kotlin-out"],
      generateKotlin(vocabulary, values["kotlin-package"] as string, values["kotlin-prefix"] ?? ""),
    );
    wrote.push(values["kotlin-out"]);
  }
  if (values["ts-out"] !== undefined) {
    await io.writeFile(
      values["ts-out"],
      generateTs(
        vocabulary,
        values["ts-prefix"] ?? defaultPrefix(vocabulary),
        values["ts-core-import"] ?? "@get-milano/core",
      ),
    );
    wrote.push(values["ts-out"]);
  }
  for (const file of wrote) io.stdout(`generated ${file}\n`);
  return 0;
}
