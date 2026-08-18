import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  useColorScheme,
} from "react-native";

/**
 * The app's own component library: plain React Native, no Milano import
 * anywhere in this file. It is the design system a real app already owns
 * before adopting Milano, and the only thing the bridge is allowed to
 * reach for.
 */

export interface Palette {
  readonly background: string;
  readonly surface: string;
  readonly text: string;
  readonly secondaryText: string;
  readonly accent: string;
  readonly onAccent: string;
  readonly disabled: string;
  readonly danger: string;
}

const light: Palette = {
  background: "#FFFFFF",
  surface: "#F2F2F7",
  text: "#11111C",
  secondaryText: "#6E6E7A",
  accent: "#4B3BD8",
  onAccent: "#FFFFFF",
  disabled: "#C7C7CF",
  danger: "#C4293B",
};

const dark: Palette = {
  background: "#0D0D14",
  surface: "#1B1B26",
  text: "#F4F4F8",
  secondaryText: "#9A9AA8",
  accent: "#9C8CFF",
  onAccent: "#14141F",
  disabled: "#3A3A48",
  danger: "#FF7A88",
};

export function usePalette(): Palette {
  return useColorScheme() === "dark" ? dark : light;
}

export function Screen({ children }: { readonly children: ReactNode }): ReactNode {
  const palette = usePalette();
  return (
    <ScrollView
      style={{ backgroundColor: palette.background }}
      contentContainerStyle={styles.screenContent}
    >
      {children}
    </ScrollView>
  );
}

export function Loading({ label }: { readonly label?: string }): ReactNode {
  const palette = usePalette();
  return (
    <View style={styles.centered}>
      <ActivityIndicator color={palette.accent} />
      {label === undefined ? null : (
        <Text style={{ color: palette.secondaryText, marginTop: 8 }}>{label}</Text>
      )}
    </View>
  );
}

export function Failure({
  title,
  detail,
}: {
  readonly title: string;
  readonly detail: string;
}): ReactNode {
  const palette = usePalette();
  return (
    <View style={styles.failure}>
      <Text style={[styles.failureTitle, { color: palette.danger }]}>{title}</Text>
      <Text style={{ color: palette.secondaryText, fontSize: 12 }}>{detail}</Text>
    </View>
  );
}

export type TextRole = "title" | "subtitle" | "body";
export type LiveRegion = "polite" | "assertive";

/**
 * Announces a live-region change on iOS. `accessibilityLiveRegion` is
 * Android's mechanism; VoiceOver needs an explicit announcement, so a
 * document that declares `liveRegion` is heard on both platforms.
 */
function useAnnouncement(text: string, liveRegion: LiveRegion | undefined): void {
  const previous = useRef(text);
  useEffect(() => {
    const changed = previous.current !== text;
    previous.current = text;
    if (!changed || liveRegion === undefined) return;
    if (Platform.OS === "ios") AccessibilityInfo.announceForAccessibility(text);
  }, [text, liveRegion]);
}

export interface StyledTextProps {
  readonly text: string;
  readonly role: TextRole;
  readonly liveRegion?: LiveRegion | undefined;
}

export function StyledText({ text, role, liveRegion }: StyledTextProps): ReactNode {
  const palette = usePalette();
  useAnnouncement(text, liveRegion);
  const style =
    role === "title"
      ? { fontSize: 24, fontWeight: "700" as const, color: palette.text }
      : role === "subtitle"
        ? { fontSize: 16, fontWeight: "600" as const, color: palette.secondaryText }
        : { fontSize: 15, color: palette.text };
  return (
    <Text
      style={style}
      accessibilityLiveRegion={liveRegion}
      accessibilityRole={role === "title" ? "header" : undefined}
    >
      {text}
    </Text>
  );
}

export interface PrimaryButtonProps {
  readonly label: string;
  readonly enabled: boolean;
  readonly onPress: () => void;
}

export function PrimaryButton({ label, enabled, onPress }: PrimaryButtonProps): ReactNode {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !enabled }}
      disabled={!enabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: enabled ? palette.accent : palette.disabled,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <Text style={[styles.buttonLabel, { color: palette.onAccent }]}>{label}</Text>
    </Pressable>
  );
}

export interface LabeledTextFieldProps {
  readonly label: string;
  readonly value: string;
  readonly required: boolean;
  readonly error?: string | undefined;
  readonly onChange: (value: string) => void;
  readonly onFocus?: (() => void) | undefined;
  readonly onBlur?: (() => void) | undefined;
}

export function LabeledTextField({
  label,
  value,
  required,
  error,
  onChange,
  onFocus,
  onBlur,
}: LabeledTextFieldProps): ReactNode {
  const palette = usePalette();
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: palette.secondaryText }]}>
        {required ? `${label} *` : label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        onFocus={onFocus}
        onBlur={onBlur}
        placeholderTextColor={palette.secondaryText}
        style={[
          styles.input,
          {
            color: palette.text,
            backgroundColor: palette.surface,
            borderColor: error === undefined ? "transparent" : palette.danger,
          },
        ]}
      />
      {error === undefined ? null : (
        <Text accessibilityLiveRegion="polite" style={{ color: palette.danger, fontSize: 12 }}>
          {error}
        </Text>
      )}
    </View>
  );
}

export interface LabeledNumberFieldProps {
  readonly label: string;
  readonly value: number;
  readonly onChange: (value: number) => void;
  readonly onFocus?: (() => void) | undefined;
  readonly onBlur?: (() => void) | undefined;
}

/**
 * Keeps the raw keystrokes locally so a half-typed number ("12.") stays
 * editable, and reports only parsed values upstream. The document never
 * sees the intermediate text.
 */
export function LabeledNumberField({
  label,
  value,
  onChange,
  onFocus,
  onBlur,
}: LabeledNumberFieldProps): ReactNode {
  const palette = usePalette();
  const [draft, setDraft] = useState<string | null>(null);
  // The document is the source of truth: when its value changes under us,
  // the local draft is stale and goes away.
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    setDraft(null);
  }
  const shown = draft ?? String(value);
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: palette.secondaryText }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        keyboardType="decimal-pad"
        value={shown}
        onChangeText={(text) => {
          setDraft(text);
          // An emptied field means zero, not "keep the old number": leaving
          // the document at the previous value would show a total computed
          // from a number no longer on screen.
          if (text.trim() === "") {
            onChange(0);
            return;
          }
          const parsed = Number(text);
          if (Number.isFinite(parsed)) onChange(parsed);
        }}
        onFocus={onFocus}
        onBlur={() => {
          setDraft(null);
          onBlur?.();
        }}
        style={[
          styles.input,
          { color: palette.text, backgroundColor: palette.surface, borderColor: "transparent" },
        ]}
      />
    </View>
  );
}

export interface LabeledToggleProps {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}

export function LabeledToggle({ label, checked, onChange }: LabeledToggleProps): ReactNode {
  const palette = usePalette();
  return (
    <View style={styles.toggleRow}>
      <Text style={{ color: palette.text, flex: 1, fontSize: 15 }}>{label}</Text>
      <Switch accessibilityLabel={label} value={checked} onValueChange={onChange} />
    </View>
  );
}

export type BannerLayout = "overlay" | "card" | "strip";
export type BannerAlignment =
  | "topLeading"
  | "topTrailing"
  | "center"
  | "bottomLeading"
  | "bottomTrailing";

export interface BannerProps {
  readonly layout: BannerLayout;
  readonly imageUrl?: string | undefined;
  readonly height: number;
  readonly contentAlignment: BannerAlignment;
  readonly showScrim: boolean;
  readonly cornerRadius: number;
  readonly children: ReactNode;
}

const alignments: Record<
  BannerAlignment,
  { justifyContent: "flex-start" | "center" | "flex-end"; alignItems: "flex-start" | "center" | "flex-end" }
> = {
  topLeading: { justifyContent: "flex-start", alignItems: "flex-start" },
  topTrailing: { justifyContent: "flex-start", alignItems: "flex-end" },
  center: { justifyContent: "center", alignItems: "center" },
  bottomLeading: { justifyContent: "flex-end", alignItems: "flex-start" },
  bottomTrailing: { justifyContent: "flex-end", alignItems: "flex-end" },
};

export function BannerView({
  layout,
  imageUrl,
  height,
  contentAlignment,
  showScrim,
  cornerRadius,
  children,
}: BannerProps): ReactNode {
  const palette = usePalette();
  const alignment = alignments[contentAlignment];
  if (layout === "strip") {
    return (
      <View
        style={[
          styles.strip,
          { backgroundColor: palette.surface, borderRadius: cornerRadius },
        ]}
      >
        {imageUrl === undefined ? null : (
          <Image source={{ uri: imageUrl }} style={styles.stripImage} />
        )}
        <View style={styles.stripContent}>{children}</View>
      </View>
    );
  }
  return (
    <View
      style={[
        styles.banner,
        {
          height,
          borderRadius: cornerRadius,
          backgroundColor: palette.surface,
          margin: layout === "card" ? 16 : 0,
        },
      ]}
    >
      {imageUrl === undefined ? null : (
        <Image source={{ uri: imageUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      )}
      {showScrim ? (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.38)" }]} />
      ) : null}
      <View style={[styles.bannerContent, alignment]}>{children}</View>
    </View>
  );
}

export interface SurfaceCardProps {
  readonly cornerRadius: number;
  readonly padding: number;
  readonly accessibilityLabel?: string | undefined;
  readonly accessibilityHint?: string | undefined;
  readonly onPress: () => void;
  readonly children: ReactNode;
}

export function SurfaceCard({
  cornerRadius,
  padding,
  accessibilityLabel,
  accessibilityHint,
  onPress,
  children,
}: SurfaceCardProps): ReactNode {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      style={({ pressed }) => [
        {
          backgroundColor: palette.surface,
          borderRadius: cornerRadius,
          padding,
          gap: 8,
          opacity: pressed ? 0.9 : 1,
        },
      ]}
    >
      {children}
    </Pressable>
  );
}

export interface RemoteImageProps {
  readonly url: string;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
  readonly cornerRadius: number;
  readonly contentDescription?: string | undefined;
  readonly decorative: boolean;
}

export function RemoteImage({
  url,
  width,
  height,
  cornerRadius,
  contentDescription,
  decorative,
}: RemoteImageProps): ReactNode {
  const palette = usePalette();
  return (
    <Image
      source={{ uri: url }}
      accessible={!decorative}
      accessibilityRole="image"
      accessibilityLabel={decorative ? undefined : contentDescription}
      importantForAccessibility={decorative ? "no-hide-descendants" : "yes"}
      resizeMode="cover"
      style={{
        width: width ?? "100%",
        height: height ?? 160,
        borderRadius: cornerRadius,
        backgroundColor: palette.surface,
      }}
    />
  );
}

export function NativeCard({
  title,
  detail,
}: {
  readonly title: string;
  readonly detail: string;
}): ReactNode {
  const palette = usePalette();
  return (
    <View style={[styles.nativeCard, { backgroundColor: palette.surface }]}>
      <Text style={{ color: palette.text, fontSize: 17, fontWeight: "600" }}>{title}</Text>
      <Text style={{ color: palette.secondaryText, fontSize: 14 }}>{detail}</Text>
    </View>
  );
}

export function NativeCarousel(): ReactNode {
  const palette = usePalette();
  const items = useMemo(() => ["Flights", "Hotels", "Rentals", "Guides"], []);
  return (
    <View style={{ paddingVertical: 8, gap: 8 }}>
      <Text style={{ color: palette.text, fontSize: 17, fontWeight: "600", paddingHorizontal: 16 }}>
        Plan something
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.carousel}>
        {items.map((item) => (
          <View key={item} style={[styles.carouselItem, { backgroundColor: palette.surface }]}>
            <Text style={{ color: palette.text, fontSize: 13 }}>{item}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

export interface MenuRowProps {
  readonly title: string;
  readonly onPress: () => void;
}

export function MenuRow({ title, onPress }: MenuRowProps): ReactNode {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.menuRow,
        { backgroundColor: palette.surface, opacity: pressed ? 0.85 : 1 },
      ]}
    >
      <Text style={{ color: palette.text, fontSize: 16 }}>{title}</Text>
      <Text style={{ color: palette.secondaryText, fontSize: 16 }}>{"›"}</Text>
    </Pressable>
  );
}

export function SectionHeader({ title }: { readonly title: string }): ReactNode {
  const palette = usePalette();
  return (
    <Text style={[styles.sectionHeader, { color: palette.secondaryText }]}>
      {title.toUpperCase()}
    </Text>
  );
}

const styles = StyleSheet.create({
  screenContent: { paddingBottom: 40 },
  centered: { alignItems: "center", justifyContent: "center", padding: 32 },
  failure: { padding: 16, gap: 4 },
  failureTitle: { fontSize: 16, fontWeight: "700" },
  button: { paddingVertical: 14, paddingHorizontal: 20, borderRadius: 12, alignItems: "center" },
  buttonLabel: { fontSize: 16, fontWeight: "600" },
  field: { gap: 6 },
  fieldLabel: { fontSize: 13 },
  input: { borderRadius: 10, borderWidth: 1, fontSize: 16, padding: 12 },
  toggleRow: { alignItems: "center", flexDirection: "row", gap: 12 },
  banner: { overflow: "hidden" },
  bannerContent: { flex: 1, gap: 8, padding: 16 },
  strip: { alignItems: "center", flexDirection: "row", gap: 12, margin: 16, padding: 12 },
  stripImage: { borderRadius: 8, height: 48, width: 48 },
  stripContent: { flex: 1, gap: 4 },
  nativeCard: { borderRadius: 16, gap: 4, margin: 16, padding: 16 },
  carousel: { gap: 12, paddingHorizontal: 16 },
  carouselItem: {
    alignItems: "center",
    borderRadius: 14,
    height: 84,
    justifyContent: "center",
    width: 96,
  },
  menuRow: {
    alignItems: "center",
    borderRadius: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    marginHorizontal: 16,
    marginVertical: 4,
    padding: 16,
  },
  sectionHeader: { fontSize: 12, letterSpacing: 1, paddingHorizontal: 20, paddingTop: 20 },
});
