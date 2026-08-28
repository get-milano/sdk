/**
 * Milano's command line, as a library: what `milano validate`, `milano
 * schema`, `milano diff`, and `milano bindings` do, callable from a build
 * script. The gate is `@get-milano/core`'s own; nothing here decides
 * validity. The generators and the diff are ports of the specs
 * repository's tools and produce the same bytes.
 */
export { unknownKeyWarnings, validate } from "./validate.ts";
export type {
  ReportedError,
  ReportedOccurrence,
  ValidateOptions,
  ValidationReport,
} from "./validate.ts";
export { documentSchema, renderSchema, specialize } from "./schema.ts";
export type { JsonObject } from "./schema.ts";
export { diff, report as diffReport, semver, typeChange } from "./diff.ts";
export type { Change, DiffReport, Verdict } from "./diff.ts";
export { BindingError, defaultPrefix, generateKotlin, generateSwift, generateTs } from "./bindings.ts";
export type { Vocabulary } from "./bindings.ts";
export { authoringSkill, identifierFrom, scaffold } from "./init.ts";
export type { ScaffoldFile } from "./init.ts";
export { main } from "./cli.ts";
export type { CliIo } from "./cli.ts";
