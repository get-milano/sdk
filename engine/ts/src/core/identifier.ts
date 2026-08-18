/**
 * The one identifier grammar, shared by component type names, property
 * names, event names, action names, and the state and context keys of
 * documents: an ASCII letter followed by ASCII letters, digits, or
 * underscores. Case-sensitive, and never starting with `$`, which is
 * reserved for the contract.
 */
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]*$/;

export function isValidIdentifier(name: string): boolean {
  return IDENTIFIER.test(name);
}
