#!/usr/bin/env node
import { readFile } from "node:fs/promises";

import { main } from "./cli.ts";

main(process.argv.slice(2), {
  readFile: (path) => readFile(path, "utf8"),
  stdout: (text) => {
    process.stdout.write(text);
  },
  stderr: (text) => {
    process.stderr.write(text);
  },
}).then(
  (status) => {
    process.exitCode = status;
  },
  (error: unknown) => {
    process.stderr.write(`milano: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  },
);
