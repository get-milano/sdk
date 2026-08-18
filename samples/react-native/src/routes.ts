/**
 * The sample's navigation vocabulary. A four-entry stack does not justify
 * a navigation library, and keeping it here means the sample's only
 * dependencies are React Native and Milano.
 */
export type Route =
  | { readonly kind: "menu" }
  | { readonly kind: "demo"; readonly id: string }
  | { readonly kind: "quickstart" }
  | { readonly kind: "pokemon" }
  | { readonly kind: "profile" }
  | { readonly kind: "catalog" }
  | { readonly kind: "embedded" };

export function routeTitle(route: Route, demoTitle: (id: string) => string): string {
  switch (route.kind) {
    case "menu":
      return "Milano";
    case "demo":
      return demoTitle(route.id);
    case "quickstart":
      return "Quick start";
    case "pokemon":
      return "Pokemon";
    case "profile":
      return "Profile";
    case "catalog":
      return "Catalog";
    case "embedded":
      return "Embedded";
  }
}

/**
 * Dev affordance, mirroring MILANO_SCREEN in the SwiftUI and Compose
 * samples: `MILANO_SCREEN=banner npm start` opens a demo directly, which
 * is what the screenshot automation drives.
 */
export function initialRoute(screen: string | undefined): Route {
  switch (screen) {
    case undefined:
    case "":
      return { kind: "menu" };
    case "quickstart":
      return { kind: "quickstart" };
    case "pokemon":
      return { kind: "pokemon" };
    case "profile":
      return { kind: "profile" };
    case "catalog":
      return { kind: "catalog" };
    case "embedded":
      return { kind: "embedded" };
    default:
      return { kind: "demo", id: screen };
  }
}
