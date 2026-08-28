import { MilanoEngine, MilanoValue, synthesizedState } from "@get-milano/core";
import type { MilanoAction, MilanoObserver, MilanoUserInteractionObserver } from "@get-milano/core";
import type {
  MilanoPlaceholderRenderer,
  MilanoReactBuilder,
  MilanoRenderer,
} from "@get-milano/react";
import { Linking } from "react-native";

import { DOCUMENTS } from "./documents.generated.ts";
import type { DocumentName } from "./documents.generated.ts";
import { sampleRegistry } from "./milano-bridge.tsx";

/**
 * The sample's Milano setup: one engine for the whole app, the design
 * system registered once, a builder per screen. Screens depend on this
 * module, never on engine internals.
 */

/** Logs every occurrence the engine reports: the sample's telemetry. */
const observer: MilanoObserver = {
  occurrence(occurrence) {
    console.log(
      `[milano] ${occurrence.kind} view=${occurrence.viewIdentity} node=${occurrence.node ?? "-"}`,
    );
  },
};

/**
 * The sample's analytics sink: a real app forwards each record to its
 * tracker; the sample logs it. Milano implements no tracker, and the
 * records arrive unredacted, so the host owns what it keeps.
 */
const analytics: MilanoUserInteractionObserver = {
  interaction(interaction) {
    console.log(
      `[analytics] ${interaction.kind} view=${interaction.viewIdentity}` +
        ` node=${interaction.node ?? "-"} name=${interaction.name ?? "-"}`,
    );
  },
};

// The engine keeps the contract default: unknown types fail the build.
// Surfaces that can degrade gracefully opt into skip below.
const engine = new MilanoEngine<MilanoRenderer, MilanoPlaceholderRenderer>({
  vocabularyJson: document("vocabulary"),
  registry: sampleRegistry(),
  observer,
  userInteractionObserver: analytics,
});

/** One shared context for every screen: each document reads only the keys
 * it declares; the rest are ignored by rule. */
const sharedContext: Readonly<Record<string, MilanoValue>> = {
  userName: MilanoValue.string("Ada"),
  marketingConsentRequired: MilanoValue.bool(true),
};

/**
 * Documents are transported as text, exactly as a content service would
 * deliver them. Parsing them here through the engine keeps the int/double
 * distinction that `JSON.parse` would flatten.
 */
export function document(name: DocumentName): string {
  return DOCUMENTS[name];
}

/**
 * Only https with a host leaves the app. Hermes' URL is partial, so a
 * strict pattern does the parsing; the host part refuses userinfo (`@`)
 * so `https://trusted@evil` cannot pass as trusted.
 */
const SAFE_URL = /^https:\/\/[^\s/?#@]+(?:[/?#]|$)/i;

/**
 * Self-contained documents (banners, the tip calculator): context
 * injected, declared state given instant defaults. A screen may add its
 * own context values on top of the shared ones (the Pokemon demo injects
 * what it fetched); on a key collision the screen wins.
 */
export function documentBuilder(
  resource: DocumentName,
  screenContext: Readonly<Record<string, MilanoValue>> = {},
): MilanoReactBuilder {
  const builder = engine.viewBuilder(document(resource));
  // Banners are optional, promotional surfaces: an unknown component
  // degrades to a gap instead of failing the build. The form and the
  // interstitial keep the fail default; their content is load-bearing.
  if (resource.startsWith("banner")) builder.unknownTypePolicy("skip");
  return builder
    .context({ ...sharedContext, ...screenContext })
    .stateData((declarations) => synthesizedState(declarations))
    .actionHandler(handle)
    .label(resource);
}

/**
 * What the catalog service answers: one record per item, in the shape the
 * document declares for `items`.
 */
const SPRITES = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork";

function catalogItem(name: string, blurb: string, sprite: number, slug: string): MilanoValue {
  return MilanoValue.record({
    name: MilanoValue.string(name),
    blurb: MilanoValue.string(blurb),
    imageUrl: MilanoValue.string(`${SPRITES}/${sprite}.png`),
    url: MilanoValue.string(`https://www.pokemon.com/us/pokedex/${slug}`),
  });
}

const CATALOG_ITEMS: readonly MilanoValue[] = [
  catalogItem("Bulbasaur", "Grass and poison. Loves the sun.", 1, "bulbasaur"),
  catalogItem("Charmander", "Fire type. Keep it dry.", 4, "charmander"),
  catalogItem("Squirtle", "Water type. Shell first.", 7, "squirtle"),
  catalogItem("Pikachu", "Electric type. The famous one.", 25, "pikachu"),
];

/**
 * The catalog: one `$repeat` over `state.items`, so the document is the
 * template and the list is data the state data provider supplies, here as
 * a catalog service would answer.
 */
export function catalogBuilder(): MilanoReactBuilder {
  return engine
    .viewBuilder(document("catalog"))
    .context(sharedContext)
    .stateData(() => ({ items: MilanoValue.array(CATALOG_ITEMS) }))
    .actionHandler(handle)
    .label("catalog");
}

/**
 * The interstitial: the document's `dismiss` action is interpreted by the
 * presenting screen; every other action takes the shared path.
 */
export function interstitialBuilder(onDismiss: () => void): MilanoReactBuilder {
  return engine
    .viewBuilder(document("interstitial"))
    .context(sharedContext)
    .actionHandler(async (action) => {
      if (action.name === "dismiss") {
        onDismiss();
        return null;
      }
      return handle(action);
    })
    .label("interstitial");
}

/**
 * The form: initial values arrive through the async state data provider,
 * as if fetched from an API.
 */
export function formBuilder(): MilanoReactBuilder {
  return engine
    .viewBuilder(document("contact-form"))
    .context(sharedContext)
    .stateData(async (declarations) => {
      await new Promise<void>((resolve) => {
        setTimeout(() => resolve(), 700);
      });
      return synthesizedState(declarations);
    })
    .actionHandler(handle)
    .label("contact-form");
}

/**
 * The single async funnel: navigation and submission live in the host.
 * The returned value is the completion result: `submitContact` declares
 * `result: "string"`, so its confirmation number flows back into the
 * document's `onSuccess` actions as the `result` root.
 */
async function handle(action: MilanoAction): Promise<MilanoValue | null> {
  switch (action.name) {
    case "openUrl": {
      // The handler is the last capability check (state and actions spec):
      // the gate proved `url` is a string, not that it is safe to open. A
      // real app narrows this to its own hosts. Throwing fails the
      // completion, so a document that binds onFailure hears about it.
      const url = action.parameters["url"]?.stringValue ?? "";
      if (!SAFE_URL.test(url)) {
        console.log(`[sample] refused url ${url}: only https with a host is opened`);
        throw new Error(`refused url ${url}`);
      }
      await Linking.openURL(url);
      return null;
    }
    case "submitContact": {
      const name = action.parameters["name"]?.stringValue ?? "";
      const surname = action.parameters["surname"]?.stringValue ?? "";
      const email = action.parameters["email"]?.stringValue ?? "";
      console.log(`[sample] submitting ${name} ${surname} <${email}>`);
      // Simulated network call; the returned confirmation number is what a
      // real backend would answer with.
      await new Promise<void>((resolve) => {
        setTimeout(() => resolve(), 1000);
      });
      const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
      return MilanoValue.string(`MC-${suffix}`);
    }
    case "dismiss":
      // Interpreted by the presenting screen's handler; inert here.
      return null;
    default:
      console.log(`[sample] unhandled action ${action.name}`);
      return null;
  }
}
