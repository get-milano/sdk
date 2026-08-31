**What changes, and why**

**Checklist**

- [ ] Behaviour follows [the specification](https://github.com/get-milano/specs); a mechanics change landed there first, with vectors.
- [ ] Swift, Kotlin, and TypeScript change together, and the conformance suite is green on all three.
- [ ] `swiftlint --strict`, `scripts/lint-kotlin.sh`, and `npm run typecheck` are clean.
- [ ] `npm test` and `node scripts/check-consistency.mjs` pass; all four samples build.
- [ ] Docs and `CHANGELOG.md` updated when consumers would notice.
- [ ] No em dashes in prose.
