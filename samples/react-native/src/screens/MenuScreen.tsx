import { MilanoInfo } from "@get-milano/core";
import type { ReactNode } from "react";
import { Text, View } from "react-native";

import { MenuRow, Screen, SectionHeader, usePalette } from "../design-system.tsx";
import type { Route } from "../routes.ts";

/**
 * The menu: every demo the sample ships, grouped the way the SwiftUI and
 * Compose samples group them. Each entry pushes a screen that builds its
 * own MilanoView on entry, so the loading content is visible every time.
 */
export function MenuScreen({
  onNavigate,
  onPresentInterstitial,
}: {
  readonly onNavigate: (route: Route) => void;
  readonly onPresentInterstitial: () => void;
}): ReactNode {
  const palette = usePalette();
  return (
    <Screen>
      <SectionHeader title="Banners" />
      <MenuRow title="Banner · Overlay" onPress={() => onNavigate({ kind: "demo", id: "banner" })} />
      <MenuRow
        title="Banner · Card"
        onPress={() => onNavigate({ kind: "demo", id: "banner-card" })}
      />
      <MenuRow
        title="Banner · Strip"
        onPress={() => onNavigate({ kind: "demo", id: "banner-strip" })}
      />

      <SectionHeader title="Forms" />
      <MenuRow title="Contact form" onPress={() => onNavigate({ kind: "demo", id: "form" })} />

      <SectionHeader title="Expressions" />
      <MenuRow
        title="Tip calculator"
        onPress={() => onNavigate({ kind: "demo", id: "tip-calculator" })}
      />
      <MenuRow
        title="Checkbox gate"
        onPress={() => onNavigate({ kind: "demo", id: "checkbox-gate" })}
      />

      <SectionHeader title="Quick start" />
      <MenuRow
        title="One view, no architecture"
        onPress={() => onNavigate({ kind: "quickstart" })}
      />

      <SectionHeader title="Context" />
      <MenuRow title="Pokemon · Screen context" onPress={() => onNavigate({ kind: "pokemon" })} />

      <SectionHeader title="Whole screens" />
      <MenuRow title="Profile" onPress={() => onNavigate({ kind: "profile" })} />
      <MenuRow title="Catalog · Tap to open" onPress={() => onNavigate({ kind: "catalog" })} />

      <SectionHeader title="Integration" />
      <MenuRow title="Embedded in native UI" onPress={() => onNavigate({ kind: "embedded" })} />
      <MenuRow title="Interstitial" onPress={onPresentInterstitial} />

      <SectionHeader title="Engine" />
      <View style={{ paddingHorizontal: 20, paddingTop: 8 }}>
        <Text style={{ color: palette.secondaryText }}>Milano SDK {MilanoInfo.version}</Text>
      </View>
    </Screen>
  );
}
