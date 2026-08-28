/**
 * Milano's command line, as a library: what `milano validate` does, callable
 * from a build script. The gate is `@get-milano/core`'s own; nothing here
 * decides validity.
 */
export { unknownKeyWarnings, validate } from "./validate.ts";
export type {
  ReportedError,
  ReportedOccurrence,
  ValidateOptions,
  ValidationReport,
} from "./validate.ts";
export { main } from "./cli.ts";
export type { CliIo } from "./cli.ts";
