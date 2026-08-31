// Generated from vocabulary "examples" 1.5.0 by generate_bindings.py.
// Do not edit; regenerate when the vocabulary changes.

import { MilanoValue } from "@get-milano/core";
import type { MilanoAction } from "@get-milano/core";

/**
 * What these wrappers need from a resolved node. The React binding's
 * `MilanoNode` satisfies it, and so does any other host wrapper, so
 * the generated file never depends on a UI toolkit.
 */
export interface MilanoNodeLike {
  property(name: string): MilanoValue;
  emit(event: string, payload?: MilanoValue | null): void;
}

/** Members of the `contentAlignment` enum on `Banner`. Gate-guaranteed: the value is always a member. */
export type SampleBannerContentAlignment = "bottomLeading" | "bottomTrailing" | "center" | "topLeading" | "topTrailing";

/** Members of the `layout` enum on `Banner`. Gate-guaranteed: the value is always a member. */
export type SampleBannerLayout = "card" | "overlay" | "strip";

/** Members of the `style` enum on `Card`. Gate-guaranteed: the value is always a member. */
export type SampleCardStyle = "plain" | "surface";

/** Members of the `width` enum on `Column`. Gate-guaranteed: the value is always a member. */
export type SampleColumnWidth = "content" | "fill";

/** Members of the `container` enum on `Icon`. Gate-guaranteed: the value is always a member. */
export type SampleIconContainer = "circle" | "plain";

/** Members of the `name` enum on `Icon`. Gate-guaranteed: the value is always a member. */
export type SampleIconName = "edit" | "help" | "list" | "person" | "search" | "settings";

/** Members of the `icon` enum on `IconButton`. Gate-guaranteed: the value is always a member. */
export type SampleIconButtonIcon = "eye" | "eyeOff";

/** Members of the `alignment` enum on `Row`. Gate-guaranteed: the value is always a member. */
export type SampleRowAlignment = "bottom" | "center" | "top";

/** Members of the `liveRegion` enum on `Text`. Gate-guaranteed: the value is always a member. */
export type SampleTextLiveRegion = "assertive" | "polite";

/** Members of the `role` enum on `Text`. Gate-guaranteed: the value is always a member. */
export type SampleTextRole = "body" | "caption" | "subtitle" | "title";

/** Members of the `screen` enum on action `navigate`. Gate-guaranteed: the value is always a member. */
export type SampleNavigateScreen = "catalog" | "form" | "pokemon" | "profile";

/** Members of the failure enum of action `submitContact`. Gate-guaranteed: the value is always a member. */
export type SampleSubmitContactFailure = "invalidEmail" | "unavailable";

/** Members of the `event` enum on action `track`. Gate-guaranteed: the value is always a member. */
export type SampleTrackEvent = "appeared" | "disappeared" | "tapped";

/** Typed view of a resolved `Banner` node. Non-optional accessors are gate-guaranteed. */
export class SampleBannerNode {
  readonly node: MilanoNodeLike;

  constructor(node: MilanoNodeLike) {
    this.node = node;
  }

  get backgroundImageUrl(): string | null { return this.node.property("backgroundImageUrl").stringValue; }

  get contentAlignment(): SampleBannerContentAlignment | null {
    return this.node.property("contentAlignment").stringValue as SampleBannerContentAlignment | null;
  }

  get cornerRadius(): bigint | null { return this.node.property("cornerRadius").intValue; }

  get height(): bigint | null { return this.node.property("height").intValue; }

  get layout(): SampleBannerLayout | null {
    return this.node.property("layout").stringValue as SampleBannerLayout | null;
  }

  get showScrim(): boolean | null { return this.node.property("showScrim").boolValue; }

  get visible(): boolean | null { return this.node.property("visible").boolValue; }
}

/** Typed view of a resolved `Button` node. Non-optional accessors are gate-guaranteed. */
export class SampleButtonNode {
  readonly node: MilanoNodeLike;

  constructor(node: MilanoNodeLike) {
    this.node = node;
  }

  get enabled(): boolean { return this.node.property("enabled").boolValue as boolean; }

  get label(): string { return this.node.property("label").stringValue as string; }

  get visible(): boolean | null { return this.node.property("visible").boolValue; }

  emitTap(): void { this.node.emit("tap"); }
}

/** Typed view of a resolved `Card` node. Non-optional accessors are gate-guaranteed. */
export class SampleCardNode {
  readonly node: MilanoNodeLike;

  constructor(node: MilanoNodeLike) {
    this.node = node;
  }

  get accessibilityHint(): string | null { return this.node.property("accessibilityHint").stringValue; }

  get accessibilityLabel(): string | null { return this.node.property("accessibilityLabel").stringValue; }

  get cornerRadius(): bigint | null { return this.node.property("cornerRadius").intValue; }

  get padding(): bigint | null { return this.node.property("padding").intValue; }

  get style(): SampleCardStyle | null {
    return this.node.property("style").stringValue as SampleCardStyle | null;
  }

  emitTap(): void { this.node.emit("tap"); }
}

/** Typed view of a resolved `Checkbox` node. Non-optional accessors are gate-guaranteed. */
export class SampleCheckboxNode {
  readonly node: MilanoNodeLike;

  constructor(node: MilanoNodeLike) {
    this.node = node;
  }

  get checked(): boolean { return this.node.property("checked").boolValue as boolean; }

  get label(): string { return this.node.property("label").stringValue as string; }

  get visible(): boolean | null { return this.node.property("visible").boolValue; }

  emitChange(payload: boolean): void { this.node.emit("change", MilanoValue.bool(payload)); }
}

/** Typed view of a resolved `Column` node. Non-optional accessors are gate-guaranteed. */
export class SampleColumnNode {
  readonly node: MilanoNodeLike;

  constructor(node: MilanoNodeLike) {
    this.node = node;
  }

  get padding(): bigint | null { return this.node.property("padding").intValue; }

  get width(): SampleColumnWidth | null {
    return this.node.property("width").stringValue as SampleColumnWidth | null;
  }
}

/** Typed view of a resolved `Icon` node. Non-optional accessors are gate-guaranteed. */
export class SampleIconNode {
  readonly node: MilanoNodeLike;

  constructor(node: MilanoNodeLike) {
    this.node = node;
  }

  get container(): SampleIconContainer | null {
    return this.node.property("container").stringValue as SampleIconContainer | null;
  }

  get name(): SampleIconName {
    return this.node.property("name").stringValue as SampleIconName;
  }

  get visible(): boolean | null { return this.node.property("visible").boolValue; }
}

/** Typed view of a resolved `IconButton` node. Non-optional accessors are gate-guaranteed. */
export class SampleIconButtonNode {
  readonly node: MilanoNodeLike;

  constructor(node: MilanoNodeLike) {
    this.node = node;
  }

  get accessibilityHint(): string | null { return this.node.property("accessibilityHint").stringValue; }

  get accessibilityLabel(): string { return this.node.property("accessibilityLabel").stringValue as string; }

  get icon(): SampleIconButtonIcon {
    return this.node.property("icon").stringValue as SampleIconButtonIcon;
  }

  emitPressEnd(): void { this.node.emit("pressEnd"); }

  emitPressStart(): void { this.node.emit("pressStart"); }
}

/** Typed view of a resolved `Image` node. Non-optional accessors are gate-guaranteed. */
export class SampleImageNode {
  readonly node: MilanoNodeLike;

  constructor(node: MilanoNodeLike) {
    this.node = node;
  }

  get contentDescription(): string | null { return this.node.property("contentDescription").stringValue; }

  get cornerRadius(): bigint | null { return this.node.property("cornerRadius").intValue; }

  get decorative(): boolean | null { return this.node.property("decorative").boolValue; }

  get height(): bigint | null { return this.node.property("height").intValue; }

  get url(): string { return this.node.property("url").stringValue as string; }

  get width(): bigint | null { return this.node.property("width").intValue; }
}

/** Typed view of a resolved `NumberField` node. Non-optional accessors are gate-guaranteed. */
export class SampleNumberFieldNode {
  readonly node: MilanoNodeLike;

  constructor(node: MilanoNodeLike) {
    this.node = node;
  }

  get label(): string { return this.node.property("label").stringValue as string; }

  get value(): number { return this.node.property("value").doubleValue as number; }

  get visible(): boolean | null { return this.node.property("visible").boolValue; }

  emitChange(payload: number): void { this.node.emit("change", MilanoValue.double(payload)); }
}

/** Typed view of a resolved `Row` node. Non-optional accessors are gate-guaranteed. */
export class SampleRowNode {
  readonly node: MilanoNodeLike;

  constructor(node: MilanoNodeLike) {
    this.node = node;
  }

  get alignment(): SampleRowAlignment | null {
    return this.node.property("alignment").stringValue as SampleRowAlignment | null;
  }

  get horizontalPadding(): bigint | null { return this.node.property("horizontalPadding").intValue; }

  get scrolls(): boolean | null { return this.node.property("scrolls").boolValue; }

  get spacing(): bigint | null { return this.node.property("spacing").intValue; }
}

/** Typed view of a resolved `Text` node. Non-optional accessors are gate-guaranteed. */
export class SampleTextNode {
  readonly node: MilanoNodeLike;

  constructor(node: MilanoNodeLike) {
    this.node = node;
  }

  get liveRegion(): SampleTextLiveRegion | null {
    return this.node.property("liveRegion").stringValue as SampleTextLiveRegion | null;
  }

  get role(): SampleTextRole | null {
    return this.node.property("role").stringValue as SampleTextRole | null;
  }

  get text(): string { return this.node.property("text").stringValue as string; }

  get visible(): boolean | null { return this.node.property("visible").boolValue; }
}

/** Typed view of a resolved `TextField` node. Non-optional accessors are gate-guaranteed. */
export class SampleTextFieldNode {
  readonly node: MilanoNodeLike;

  constructor(node: MilanoNodeLike) {
    this.node = node;
  }

  get error(): string | null { return this.node.property("error").stringValue; }

  get label(): string { return this.node.property("label").stringValue as string; }

  get required(): boolean | null { return this.node.property("required").boolValue; }

  get value(): string { return this.node.property("value").stringValue as string; }

  get visible(): boolean | null { return this.node.property("visible").boolValue; }

  emitChange(payload: string): void { this.node.emit("change", MilanoValue.string(payload)); }
}

/** Every custom action this vocabulary declares, decoded from dispatch. */
export type SampleAction =
  | { readonly kind: "dismiss" }
  | { readonly kind: "navigate"; readonly screen: SampleNavigateScreen }
  | { readonly kind: "openUrl"; readonly url: string }
  /**
   * The handler completes it with a `string` result, bound to `result` in onSuccess.
   * The handler fails it with a `{"enum": ["invalidEmail", "unavailable"]}` payload (a
   * MilanoActionFailure), bound to `failure` in onFailure.
   */
  | {
      readonly kind: "submitContact";
      readonly email: string;
      readonly name: string;
      readonly phone: string | null;
      readonly surname: string;
    }
  | {
      readonly kind: "track";
      readonly event: SampleTrackEvent;
      readonly position: bigint | null;
      readonly surface: string;
    }
  /** An action outside this vocabulary's declarations (builder-declared, or a newer vocabulary). */
  | { readonly kind: "unrecognized"; readonly action: MilanoAction };

/** Decodes a dispatched action; the switch over `kind` is exhaustive. */
export function sampleAction(action: MilanoAction): SampleAction {
  switch (action.name) {
    case "dismiss":
      return { kind: "dismiss" };
    case "navigate":
      return { kind: "navigate", screen: action.parameters["screen"]?.stringValue as SampleNavigateScreen };
    case "openUrl":
      return { kind: "openUrl", url: action.parameters["url"]?.stringValue as string };
    case "submitContact":
      return {
        kind: "submitContact",
        email: action.parameters["email"]?.stringValue as string,
        name: action.parameters["name"]?.stringValue as string,
        phone: action.parameters["phone"]?.stringValue as string | null,
        surname: action.parameters["surname"]?.stringValue as string,
      };
    case "track":
      return {
        kind: "track",
        event: action.parameters["event"]?.stringValue as SampleTrackEvent,
        position: action.parameters["position"]?.intValue as bigint | null,
        surface: action.parameters["surface"]?.stringValue as string,
      };
    default:
      return { kind: "unrecognized", action };
  }
}

/** The vocabulary these bindings were generated from. */
export const SampleVocabulary = {
  name: "examples",
  version: "1.5.0",

  /** Throws if the engine holds a different vocabulary. */
  assertMatches(engine: { readonly vocabulary: { readonly name: string; readonly version: string } }): void {
    const held = engine.vocabulary;
    if (held.name !== "examples" || held.version !== "1.5.0") {
      throw new Error(
        `bindings generated from examples@1.5.0, engine holds ${held.name}@${held.version}`,
      );
    }
  },
} as const;
