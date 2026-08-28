#!/usr/bin/env node
import { access, mkdir, readFile, writeFile } from "node:fs/promises";

import { main } from "./cli.ts";

main(process.argv.slice(2), {
  readFile: (path) => readFile(path, "utf8"),
  writeFile: (path, text) => writeFile(path, text, "utf8"),
  exists: (path) => access(path).then(() => true, () => false),
  mkdir: async (path) => {
    await mkdir(path, { recursive: true });
  },
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
