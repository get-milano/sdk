import { MilanoValue } from "@get-milano/core";
import { createMilanoRegistry } from "@get-milano/react";
import type {
  MilanoNode,
  MilanoPlaceholderRenderer,
  MilanoReactRegistry,
  MilanoRenderer,
} from "@get-milano/react";
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";

import {
  BannerView,
  LabeledNumberField,
  LabeledTextField,
  LabeledToggle,
  PrimaryButton,
  RemoteImage,
  StyledText,
  SurfaceCard,
} from "./design-system.tsx";
import type { BannerAlignment, BannerLayout, LiveRegion, TextRole } from "./design-system.tsx";

/**
 * The one doorway between Milano and the design system. Every renderer
 * reads declared properties through the node, maps them onto a design
 * system component, and emits declared events back. Nothing here decides
 * what the screen says; the documents do.
 *
 * Reads are gate-guaranteed: a property declared `string` always answers a
 * string, a declared enum always answers one of its members, so the `??`
 * fallbacks below cover optionals only.
 */

function text(node: MilanoNode, name: string): string {
  return node.property(name).stringValue ?? "";
}

function optionalText(node: MilanoNode, name: string): string | undefined {
  return node.property(name).stringValue ?? undefined;
}

function flag(node: MilanoNode, name: string, fallback: boolean): boolean {
  return node.property(name).boolValue ?? fallback;
}

function integer(node: MilanoNode, name: string, fallback: number): number {
  const value = node.property(name).intValue;
  return value === null ? fallback : Number(value);
}

function optionalInteger(node: MilanoNode, name: string): number | undefined {
  const value = node.property(name).intValue;
  return value === null ? undefined : Number(value);
}

/** A declared enum member, or the fallback when the optional is absent. */
function member<T extends string>(node: MilanoNode, name: string, fallback: T): T {
  return (node.property(name).stringValue as T | null) ?? fallback;
}

const ColumnRenderer: MilanoRenderer = ({ node }) => (
  <View style={{ gap: 12, padding: 16 }}>{node.children}</View>
);

const RowRenderer: MilanoRenderer = ({ node }) => (
  <View
    style={{
      alignItems: "center",
      flexDirection: "row",
      gap: integer(node, "spacing", 8),
    }}
  >
    {node.children}
  </View>
);

const TextRenderer: MilanoRenderer = ({ node }) => {
  if (!flag(node, "visible", true)) return null;
  const liveRegion = node.property("liveRegion").stringValue as LiveRegion | null;
  return (
    <StyledText
      text={text(node, "text")}
      role={member<TextRole>(node, "role", "body")}
      liveRegion={liveRegion ?? undefined}
    />
  );
};

const ButtonRenderer: MilanoRenderer = ({ node }) => {
  if (!flag(node, "visible", true)) return null;
  return (
    <PrimaryButton
      label={text(node, "label")}
      enabled={flag(node, "enabled", true)}
      // No `tap` interaction is reported here: the document models the tap
      // as an event, so it already reaches analytics as `event`. Reporting
      // it again would double-count.
      onPress={() => node.emit("tap")}
    />
  );
};

const TextFieldRenderer: MilanoRenderer = ({ node }) => {
  if (!flag(node, "visible", true)) return null;
  return (
    <LabeledTextField
      label={text(node, "label")}
      value={text(node, "value")}
      required={flag(node, "required", false)}
      error={optionalText(node, "error")}
      onChange={(value) => node.emit("change", MilanoValue.string(value))}
      onFocus={() => node.userInteraction("focusGained")}
      onBlur={() => node.userInteraction("focusLost")}
    />
  );
};

const NumberFieldRenderer: MilanoRenderer = ({ node }) => {
  if (!flag(node, "visible", true)) return null;
  return (
    <LabeledNumberField
      label={text(node, "label")}
      value={node.property("value").numberValue ?? 0}
      onChange={(value) => node.emit("change", MilanoValue.double(value))}
      onFocus={() => node.userInteraction("focusGained")}
      onBlur={() => node.userInteraction("focusLost")}
    />
  );
};

const CheckboxRenderer: MilanoRenderer = ({ node }) => {
  if (!flag(node, "visible", true)) return null;
  return (
    <LabeledToggle
      label={text(node, "label")}
      checked={flag(node, "checked", false)}
      onChange={(checked) => node.emit("change", MilanoValue.bool(checked))}
    />
  );
};

const BannerRenderer: MilanoRenderer = ({ node }) => {
  const visible = flag(node, "visible", true);
  // The impression, for banner analytics: reported once, when the banner
  // first appears. The node object is fresh after every re-resolution, so
  // the effect keys on the node's reference; keying on the node itself
  // would report an impression on every state change. The ref is written
  // in an effect, never during render.
  const current = useRef(node);
  useEffect(() => {
    current.current = node;
  });
  const reference = node.reference;
  useEffect(() => {
    if (visible) current.current.userInteraction("appeared");
  }, [reference, visible]);
  if (!visible) return null;
  const layout = member<BannerLayout>(node, "layout", "overlay");
  return (
    <BannerView
      layout={layout}
      imageUrl={optionalText(node, "backgroundImageUrl")}
      height={integer(node, "height", layout === "card" ? 170 : 260)}
      contentAlignment={member<BannerAlignment>(node, "contentAlignment", "bottomLeading")}
      showScrim={flag(node, "showScrim", true)}
      cornerRadius={integer(node, "cornerRadius", 16)}
    >
      {node.children}
    </BannerView>
  );
};

const CardRenderer: MilanoRenderer = ({ node }) => (
  <SurfaceCard
    cornerRadius={integer(node, "cornerRadius", 12)}
    padding={integer(node, "padding", 12)}
    accessibilityLabel={optionalText(node, "accessibilityLabel")}
    accessibilityHint={optionalText(node, "accessibilityHint")}
    onPress={() => node.emit("tap")}
  >
    {node.children}
  </SurfaceCard>
);

const ImageRenderer: MilanoRenderer = ({ node }) => (
  <RemoteImage
    url={text(node, "url")}
    width={optionalInteger(node, "width")}
    height={optionalInteger(node, "height")}
    cornerRadius={integer(node, "cornerRadius", 0)}
    contentDescription={optionalText(node, "contentDescription")}
    decorative={flag(node, "decorative", false)}
  />
);

/**
 * Unknown types under the `placeholder` policy arrive here as data, never
 * as live children: the sample leaves a visible gap instead of guessing.
 * No sample surface selects that policy (the banners use `skip`), so this
 * is here to show the shape and to make the policy available.
 */
const UnknownRenderer: MilanoPlaceholderRenderer = ({ node }): ReactNode => (
  <View accessibilityElementsHidden style={{ height: 8 }} testID={`unknown-${node.type}`} />
);

export function sampleRegistry(): MilanoReactRegistry {
  const registry = createMilanoRegistry();
  registry.register("Column", ColumnRenderer);
  registry.register("Row", RowRenderer);
  registry.register("Banner", BannerRenderer);
  registry.register("Card", CardRenderer);
  registry.register("Image", ImageRenderer);
  registry.register("Text", TextRenderer);
  registry.register("Button", ButtonRenderer);
  registry.register("TextField", TextFieldRenderer);
  registry.register("NumberField", NumberFieldRenderer);
  registry.register("Checkbox", CheckboxRenderer);
  registry.registerPlaceholder(UnknownRenderer);
  return registry;
}
