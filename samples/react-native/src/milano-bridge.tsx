import { createMilanoRegistry } from "@get-milano/react";
import type {
  MilanoPlaceholderRenderer,
  MilanoReactRegistry,
  MilanoRenderer,
} from "@get-milano/react";
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { ScrollView, View } from "react-native";

import {
  SampleBannerNode,
  SampleButtonNode,
  SampleCardNode,
  SampleCheckboxNode,
  SampleColumnNode,
  SampleIconButtonNode,
  SampleIconNode,
  SampleImageNode,
  SampleNumberFieldNode,
  SampleRowNode,
  SampleTextFieldNode,
  SampleTextNode,
} from "./bindings.generated.ts";
import {
  BannerView,
  IconGlyph,
  PressableIcon,
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

/**
 * `padding` is what tells a screen's root column from a column nested
 * inside a tile: the root wants the screen's inset, a tile's inner column
 * wants none, and a nested column that kept the screen inset would make
 * every tile 32 points wider than its content.
 */
const ColumnRenderer: MilanoRenderer = ({ node }) => {
  const column = new SampleColumnNode(node);
  return (
    <View
      style={{
        gap: 12,
        padding: pixels(column.padding, 16),
        // A column inside a row sizes to its content; one that stretches
        // leaves its siblings with none of the row.
        alignSelf: column.width === "content" ? "flex-start" : "auto",
      }}
    >
      {node.children}
    </View>
  );
};

/**
 * Top alignment is what keeps a strip of tiles readable: labels wrap to
 * different heights, and centring them would leave the icons on different
 * lines.
 */
const ALIGNMENT = { top: "flex-start", center: "center", bottom: "flex-end" } as const;

const RowRenderer: MilanoRenderer = ({ node }) => {
  const row = new SampleRowNode(node);
  const content = {
    alignItems: ALIGNMENT[row.alignment ?? "center"],
    flexDirection: "row" as const,
    gap: pixels(row.spacing, 8),
    paddingHorizontal: pixels(row.horizontalPadding, 0),
  };
  // A scrolling row is how a strip of tiles stays on screen whatever its
  // content: without it anything past the edge is unreachable. The
  // padding sits inside the scroll, so it reads as the strip's leading
  // and trailing inset rather than as a gap that scrolls away. Opt-in,
  // because a scrolling row gives its children unbounded width, and the
  // catalog's rows must keep wrapping.
  if (row.scrolls !== true) return <View style={content}>{node.children}</View>;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={content}>
      {node.children}
    </ScrollView>
  );
};

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
      style={card.style ?? "surface"}
      accessibilityLabel={orUndefined(card.accessibilityLabel)}
      accessibilityHint={orUndefined(card.accessibilityHint)}
      onPress={() => card.emitTap()}
    >
      {node.children}
    </SurfaceCard>
  );
};

const IconRenderer: MilanoRenderer = ({ node }) => {
  const icon = new SampleIconNode(node);
  if (icon.visible === false) return null;
  // `icon.name` is a union of the declared members, not a string: a
  // document can only ask for an icon this design system draws, and a
  // member added to the vocabulary fails the typecheck here until the
  // glyph map covers it.
  return <IconGlyph name={icon.name} container={icon.container ?? "plain"} />;
};

const IconButtonRenderer: MilanoRenderer = ({ node }) => {
  const button = new SampleIconButtonNode(node);
  return (
    <PressableIcon
      name={button.icon}
      accessibilityLabel={button.accessibilityLabel}
      accessibilityHint={orUndefined(button.accessibilityHint)}
      // The document models the press itself, so both edges are declared
      // events: no interaction is reported here, or it would double-count.
      onPressIn={() => button.emitPressStart()}
      onPressOut={() => button.emitPressEnd()}
    />
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
  registry.register("Icon", IconRenderer);
  registry.register("IconButton", IconButtonRenderer);
  registry.register("Text", TextRenderer);
  registry.register("Button", ButtonRenderer);
  registry.register("TextField", TextFieldRenderer);
  registry.register("NumberField", NumberFieldRenderer);
  registry.register("Checkbox", CheckboxRenderer);
  registry.registerPlaceholder(UnknownRenderer);
  return registry;
}
