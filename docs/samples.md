---
title: Samples
nav_order: 2
---

# Samples

Both sample apps, `samples/swiftui` and `samples/compose`, ship the same demos rendered from the same documents: what differs is only the design system doing the drawing. The screenshots below are the two apps running the identical JSON, side by side.

Every demo can be opened directly, which is also how these screenshots were taken:

- **iOS**: set the `MILANO_SCREEN` environment variable on the run scheme (`banner`, `banner-card`, `banner-strip`, `form`, `tip-calculator`, `checkbox-gate`, `pokemon`, `embedded`, `interstitial`).
- **Android**: pass the same key as a launch extra: `adb shell am start -n dev.getmilano.sample/.MainActivity -e milano_screen pokemon`.

## Banner · Overlay

One document, [`banner.json`](https://github.com/get-milano/sdk/blob/main/samples/swiftui/Resources/banner.json): a `Banner` with a remote background image, text drawn over a scrim, and a `Button` whose `tap` dispatches an `openUrl` action to the host. The greeting is an expression over the app-wide shared context (`concat('Hello, ', context.userName)`).

<p>
  <img src="assets/img/screenshots/banner-ios.png" width="285" alt="Overlay banner on iOS" />
  <img src="assets/img/screenshots/banner-android.png" width="285" alt="Overlay banner on Android" />
</p>

## Banner · Card

The same component, different declared layout: [`banner-card.json`](https://github.com/get-milano/sdk/blob/main/samples/swiftui/Resources/banner-card.json) asks for `"layout": "card"`, and each design system interprets that in its own idiom. The document never changes per platform.

<p>
  <img src="assets/img/screenshots/banner-card-ios.png" width="285" alt="Card banner on iOS" />
  <img src="assets/img/screenshots/banner-card-android.png" width="285" alt="Card banner on Android" />
</p>

## Pokemon · Screen context

[`pokemon.json`](https://github.com/get-milano/sdk/blob/main/samples/swiftui/Resources/pokemon.json) declares five context keys. One (`userName`) is satisfied by the app-wide shared context; the other four are fetched by the screen itself from [PokeAPI](https://pokeapi.co) and merged on top before building, on a key collision the screen wins. The artwork URL travels as an ordinary context string into the `Banner`'s `backgroundImageUrl`, and the height and weight lines are computed in the document with pure expressions (`str(context.pokemonHeight / 10.0)`).

This is the pattern for any screen that owns its data: fetch first, hand Milano plain values, let the gate validate everything at once. See the screen code: [`PokemonScreen.swift`](https://github.com/get-milano/sdk/blob/main/samples/swiftui/Sources/Screens/PokemonScreen.swift), [`PokemonScreen.kt`](https://github.com/get-milano/sdk/blob/main/samples/compose/app/src/main/kotlin/dev/getmilano/sample/ui/screens/PokemonScreen.kt).

<p>
  <img src="assets/img/screenshots/pokemon-ios.png" width="285" alt="Pokemon screen on iOS" />
  <img src="assets/img/screenshots/pokemon-android.png" width="285" alt="Pokemon screen on Android" />
</p>

## The rest of the catalog

Also in both apps, without screenshots here:

- **Banner · Strip**: the third declared layout of the same `Banner` component.
- **Contact form**: `TextField`, `Checkbox`, conditional visibility, required markers, expression-driven validation, and a custom `submitContact` action with `onSuccess` follow-ups.
- **Tip calculator**: all math lives in the document as expressions over state; the host ships no logic.
- **Checkbox gate**: a `$when` action wiring a checkbox to dependent state.
- **Embedded**: a Milano view between native components in a host screen.
- **Interstitial**: a full-screen document whose `dismiss` action is interpreted by the presenting screen.

The samples follow the architecture described in [Guidelines](guidelines); how renderers bind to the vocabulary is covered in [Bridge](bridge).
