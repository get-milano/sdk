/**
 * The version of this engine build. The release workflow stamps it; on
 * main it reads the development placeholder, exactly as the Swift and
 * Kotlin engines do.
 */
export const MilanoInfo = {
  version: "2.1.0",
  /** The highest contract version this engine implements. */
  contract: "2.1",
} as const;
