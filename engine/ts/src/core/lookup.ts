/**
 * Safe maps for untrusted names.
 *
 * Documents, vocabularies and host payloads carry names Milano treats as
 * plain identifiers, and `toString`, `constructor` and `valueOf` are all
 * valid identifiers. A plain JavaScript object answers those from
 * `Object.prototype`, so `map[name] === undefined` is not a membership
 * test and `map[name]` is not always the value that was stored. Swift's
 * `Dictionary` and Kotlin's `Map` have no such shadow; these helpers give
 * the TypeScript engine the same footing.
 *
 * Two rules, applied together: build every name-keyed map with
 * `emptyRecord`, and read every untrusted name with `own`.
 */

/** A map with no prototype: nothing is inherited, nothing is shadowed. */
export function emptyRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

/** A prototype-free copy of a map, safe to read and to extend. */
export function recordFrom<T>(source: Readonly<Record<string, T>>): Record<string, T> {
  return Object.assign(emptyRecord<T>(), source);
}

/** The value stored under a name, or undefined; never an inherited one. */
export function own<T>(
  map: Readonly<Record<string, T>> | undefined,
  key: string,
): T | undefined {
  if (map === undefined) return undefined;
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;
}

/** Whether a name was stored in the map, ignoring the prototype chain. */
export function hasOwn(map: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(map, key);
}
