import { createMilanoRegistry } from "@get-milano/react";
import type {
  MilanoPlaceholderRenderer,
  MilanoReactRegistry,
  MilanoRenderer,
} from "@get-milano/react";
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";

import {
  SampleBannerNode,
  SampleButtonNode,
  SampleCardNode,
  SampleCheckboxNode,
  SampleImageNode,
  SampleNumberFieldNode,
  SampleRowNode,
  SampleTextFieldNode,
  SampleTextNode,
} from "./bindings.generated.ts";
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

/**
 * The one doorway between Milano and the design system. Every renderer
 * reads declared properties through the generated bindings, maps them onto
 * a design system component, and emits declared events back. Nothing here
 * decides what the screen says; the documents do.
 *
 * The wrappers come from `npm run bindings`, generated from
 * vocabulary.json: `button.label` is a `string` because the vocabulary
 * says so, `banner.layout` is a union of its declared members, and a
 * vocabulary change that breaks this file fails the typecheck instead of
 * surfacing as an empty label at runtime.
 */

/** A declared optional, as the design system wants it. */
function orUndefined<T>(value: T | null): T | undefined {
  return value ?? undefined;
}

/** A declared int, as a number for React Native's style props. */
function pixels(value: bigint | null, fallback: number): number {
  return value === null ? fallback : Number(value);
}

const ColumnRenderer: MilanoRenderer = ({ node }) => (
  <View style={{ gap: 12, padding: 16 }}>{node.children}</View>
);

const RowRenderer: MilanoRenderer = ({ node }) => (
  <View
    style={{
      alignItems: "center",
      flexDirection: "row",
      gap: pixels(new SampleRowNode(node).spacing, 8),
    }}
  >
    {node.children}
  </View>
);

const TextRenderer: MilanoRenderer = ({ node }) => {
  const text = new SampleTextNode(node);
  if (text.visible === false) return null;
  return (
    <StyledText
      text={text.text}
      role={text.role ?? "body"}
      liveRegion={orUndefined(text.liveRegion)}
    />
  );
};

const ButtonRenderer: MilanoRenderer = ({ node }) => {
  const button = new SampleButtonNode(node);
  if (button.visible === false) return null;
  return (
    <PrimaryButton
      label={button.label}
      enabled={button.enabled}
      // No `tap` interaction is reported here: the document models the tap
      // as an event, so it already reaches analytics as `event`. Reporting
      // it again would double-count.
      onPress={() => button.emitTap()}
    />
  );
};

const TextFieldRenderer: MilanoRenderer = ({ node }) => {
  const field = new SampleTextFieldNode(node);
  if (field.visible === false) return null;
  return (
    <LabeledTextField
      label={field.label}
      value={field.value}
      required={field.required ?? false}
      error={orUndefined(field.error)}
      onChange={(value) => field.emitChange(value)}
      onFocus={() => node.userInteraction("focusGained")}
      onBlur={() => node.userInteraction("focusLost")}
    />
  );
};

const NumberFieldRenderer: MilanoRenderer = ({ node }) => {
  const field = new SampleNumberFieldNode(node);
  if (field.visible === false) return null;
  return (
    <LabeledNumberField
      label={field.label}
      value={field.value}
      onChange={(value) => field.emitChange(value)}
      onFocus={() => node.userInteraction("focusGained")}
      onBlur={() => node.userInteraction("focusLost")}
    />
  );
};

const CheckboxRenderer: MilanoRenderer = ({ node }) => {
  const checkbox = new SampleCheckboxNode(node);
  if (checkbox.visible === false) return null;
  return (
    <LabeledToggle
      label={checkbox.label}
      checked={checkbox.checked}
      onChange={(checked) => checkbox.emitChange(checked)}
    />
  );
};

const BannerRenderer: MilanoRenderer = ({ node }) => {
  const banner = new SampleBannerNode(node);
  const visible = banner.visible !== false;
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
  const layout = banner.layout ?? "overlay";
  return (
    <BannerView
      layout={layout}
      imageUrl={orUndefined(banner.backgroundImageUrl)}
      height={pixels(banner.height, layout === "card" ? 170 : 260)}
      contentAlignment={banner.contentAlignment ?? "bottomLeading"}
      showScrim={banner.showScrim ?? true}
      cornerRadius={pixels(banner.cornerRadius, 16)}
    >
      {node.children}
    </BannerView>
  );
};

const CardRenderer: MilanoRenderer = ({ node }) => {
  const card = new SampleCardNode(node);
  return (
    <SurfaceCard
      cornerRadius={pixels(card.cornerRadius, 12)}
      padding={pixels(card.padding, 12)}
      accessibilityLabel={orUndefined(card.accessibilityLabel)}
      accessibilityHint={orUndefined(card.accessibilityHint)}
      onPress={() => card.emitTap()}
    >
      {node.children}
    </SurfaceCard>
  );
};

const ImageRenderer: MilanoRenderer = ({ node }) => {
  const image = new SampleImageNode(node);
  return (
    <RemoteImage
      url={image.url}
      width={image.width === null ? undefined : Number(image.width)}
      height={image.height === null ? undefined : Number(image.height)}
      cornerRadius={pixels(image.cornerRadius, 0)}
      contentDescription={orUndefined(image.contentDescription)}
      decorative={image.decorative ?? false}
    />
  );
};

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
