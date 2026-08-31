---
title: Accessibility
nav_order: 11
---

# Accessibility

Milano's contract contains no accessibility concepts, and that is the design, not a gap: Milano never draws, so assistive-technology semantics belong to the layer that does: your renderers and design system. What the contract gives you is the mechanism: **optional typed properties, enums, and expressions**. Accessibility in a Milano app is therefore vocabulary design, done once per component and inherited by every document.

Three consequences worth internalizing before the how-to:

1. **You get a large baseline for free.** Renderers that use real platform controls inherit their semantics: the sample's `LabeledTextField`, `Checkbox`, and `PrimaryButton` carry labels, states, and actions into the accessibility tree without any document involvement. The gaps are the custom surfaces: images, tappable containers, dynamic text.
2. **Accessibility values can be expressions.** A label computed as `{"$expr": "$concat('Profile picture of ', context.userName)"}` is validated by the gate and can never drift from the data it describes, which is better than most hand-maintained native setups.
3. **Everything is optional, always.** Declare accessibility properties with `?` (or `"optional": true`); a document that omits them still builds, and the renderer falls back to sensible defaults. Accessibility should raise the ceiling, never gate the build.

## The pattern

Declare a semantic, optional property; map it in the renderer; let documents fill it in when the default is not enough. The sample vocabulary ships a complete worked set:

| Property | On | Type | SwiftUI mapping | Compose mapping | React Native mapping |
|---|---|---|---|---|---|
| `contentDescription` | `Image` | `string?` | `.accessibilityLabel(_:)` | `AsyncImage(contentDescription:)` | `accessibilityLabel` |
| `decorative` | `Image` | `bool?` | `.accessibilityHidden(true)` | `contentDescription = null` | `accessible={false}` + `importantForAccessibility="no-hide-descendants"` |
| `accessibilityLabel` | `Card` | `string?` | `.accessibilityElement(children: .ignore)` + `.accessibilityLabel(_:)` | `semantics(mergeDescendants = true) { contentDescription = label }` | `accessibilityLabel` on the `Pressable` |
| `accessibilityHint` | `Card` | `string?` | `.accessibilityHint(_:)` | `clickable(onClickLabel = hint)` | `accessibilityHint` |
| `liveRegion` | `Text` | `{"enum": ["polite", "assertive"], "optional": true}` | announcement on change (see below) | `semantics { liveRegion = Polite / Assertive }` | `accessibilityLiveRegion` |

Two mappings need no property at all, because the semantic information is already in the vocabulary:

- **Headings.** `Text.role: "title"` maps to a heading trait (`.accessibilityAddTraits(.isHeader)` / `semantics { heading() }` / `accessibilityRole="header"`) as well as a font. One declaration, two consumers.
- **Tappable cards.** `Card` declares a `tap` event, so its renderers mark it as one activatable button (`.isButton` trait / `clickable(role = Role.Button)` / `accessibilityRole="button"`), and the label collapses the children into a single, sensible announcement.

## Worked examples in the samples

The catalog's item cards put the pieces together:

```json
{
  "type": "Card",
  "properties": {
    "accessibilityLabel": "Bulbasaur",
    "accessibilityHint": "Opens the Pokedex page."
  },
  "on": { "tap": [ { "action": "openUrl", "url": "..." } ] },
  "children": [ { "type": "Image", "properties": { "decorative": true, "...": "..." } } ]
}
```

A screen reader announces one element: "Bulbasaur, button, opens the Pokedex page", not the image, the two text nodes, and a mystery tap target. The artwork is marked `decorative` because the card's label already carries its meaning; note that *absent description* and *decorative* are different intents, which is why they are separate properties.

The profile's computed summary and the contact form's thank-you line declare `"liveRegion": "polite"`, so state changes a sighted user sees ("Thanks! Your confirmation number is...") are also heard.

The quick actions strip is the same pattern with one difference worth
naming: the tile's label is visible text *inside* the button, not a
substitute for it.

```json
{
  "type": "Card",
  "properties": {
    "style": "plain",
    "accessibilityLabel": "Profile",
    "accessibilityHint": "Opens the screen."
  },
  "on": { "tap": [ "..." ] },
  "children": [
    { "type": "Column", "properties": { "padding": 0 }, "children": [
      { "type": "Icon", "properties": { "name": "person", "container": "circle" } },
      { "type": "Text", "properties": { "text": "Profile", "role": "caption" } }
    ] }
  ]
}
```

Three things make it one control rather than three. The `accessibilityLabel`
collapses the tile, so the icon and the label are announced once, as
"Profile, button", instead of the glyph and the text arriving separately.
The icon is decorative in every renderer, because the label beside it
already says what it means: an icon that announced "person" would make the
tile read "person Profile". And the hint says what activation does, which
the label alone never does.

The label being visible is what lets it stay short. A tile labelled
"Profile" needs no longer accessibility label, and inventing one
("Open your profile settings") would leave what a person sees and what
they hear disagreeing, which is worse than terse.

## Platform honesty

The platforms are not identical, and the mapping table should never pretend they are:

- **Live regions**: Compose has them natively (`LiveRegionMode`), and React Native exposes `accessibilityLiveRegion` (Android's mechanism; on iOS it is advisory). SwiftUI does not; the sample's `StyledText` approximates by posting an accessibility announcement when the text changes. Same document, same intent, best-available mechanics on each platform. `assertive` on iOS currently behaves like `polite`; if interruption matters to your product, handle it in your design system.
- **Hints**: SwiftUI and React Native have a dedicated hint slot; Compose's idiom is the click action's spoken label (`onClickLabel`). All read naturally; the wording that works for "double-tap to..." phrasing works everywhere.
- **Decorative images**: iOS and Android each need their own opt-out, and React Native needs both (`accessible={false}` covers VoiceOver, `importantForAccessibility` covers TalkBack). The sample's `RemoteImage` sets both from one declared `decorative` flag.

## Guidance for your own vocabulary

- Name properties for meaning, and keep platform names out of documents where you can. The sample uses `contentDescription` (Android's term) on `Image` and `accessibilityLabel` (Apple's term) on `Card`; pick one convention for your vocabulary and stay consistent.
- Use an enum wherever the value is a closed set (`liveRegion`). The gate then rejects typos at validation time, and the generated bindings give your renderer an exhaustive switch instead of string matching.
- Keep every accessibility property optional, and make renderers degrade sensibly when they are absent. The gate's job is catching contradictions, not enforcing completeness.
- Test with the screen reader on, not just the accessibility inspector: the catalog card collapse and the live-region announcements are behaviors you hear, not see.
