import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { MilanoEngineError, MilanoJsonError, parseJson } from "@get-milano/core";
import type { MilanoUnknownTypePolicy, MilanoValue } from "@get-milano/core";

import { validate } from "./validate.ts";
import type { ValidationReport } from "./validate.ts";

/** What the command line touches, injectable so the tests need no process. */
export interface CliIo {
  readonly readFile: (path: string) => Promise<string>;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

const USAGE = `usage: milano validate <document>... --vocabulary <file> [options]

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
      --version                the CLI's version

exit status:
  0  every document is valid
  1  at least one document was rejected
  2  usage, an unreadable file, or an invalid vocabulary
`;

const POLICIES: readonly MilanoUnknownTypePolicy[] = ["fail", "skip", "placeholder"];

class UsageError extends Error {}

const OPTIONS = {
  vocabulary: { type: "string", short: "v" },
  context: { type: "string" },
  state: { type: "string" },
  "unknown-types": { type: "string" },
  json: { type: "boolean" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean" },
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
    if (error instanceof MilanoEngineError || error instanceof MilanoJsonError) {
      io.stderr(`milano: ${error.message}\n`);
      return 2;
    }
    if (error instanceof Error && "code" in error && typeof error.code === "string") {
      // A file the host could not read: ENOENT, EACCES, EISDIR.
      io.stderr(`milano: ${error.message}\n`);
      return 2;
    }
    throw error;
  }
}

function parse(argv: readonly string[]) {
  try {
    return parseArgs({ args: [...argv], options: OPTIONS, allowPositionals: true });
  } catch (error) {
    throw new UsageError(`usage: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function run(argv: readonly string[], io: CliIo): Promise<number> {
  const { values, positionals } = parse(argv);

  if (values.help === true) {
    io.stdout(USAGE);
    return 0;
  }
  if (values.version === true) {
    io.stdout(`milano ${version()}\n`);
    return 0;
  }

  const [command, ...documents] = positionals;
  if (command === undefined) throw new UsageError("usage: a command is required");
  if (command !== "validate") throw new UsageError(`usage: unknown command ${command}`);
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

