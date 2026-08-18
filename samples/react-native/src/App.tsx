import { StatusBar } from "expo-status-bar";
import { useCallback, useState } from "react";
import type { ReactNode } from "react";
import { Pressable, Text, View, useColorScheme } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import { usePalette } from "./design-system.tsx";
import { initialRoute, routeTitle } from "./routes.ts";
import type { Route } from "./routes.ts";
import { CatalogScreen } from "./screens/CatalogScreen.tsx";
import { DEMOS, DemoScreen } from "./screens/DemoScreen.tsx";
import { EmbeddedScreen } from "./screens/EmbeddedScreen.tsx";
import { InterstitialScreen } from "./screens/InterstitialScreen.tsx";
import { MenuScreen } from "./screens/MenuScreen.tsx";
import { PokemonScreen } from "./screens/PokemonScreen.tsx";
import { ProfileScreen } from "./screens/ProfileScreen.tsx";
import { QuickStartScreen } from "./screens/QuickStartScreen.tsx";

/**
 * The screen chosen at launch, when the automation asks for one. Written
 * as a literal `process.env.<NAME>`: that exact shape is what Babel's Expo
 * preset inlines at build time, and anything else (a destructured `env`, a
 * computed key) reaches the device as undefined.
 */
function requestedScreen(): string | undefined {
  return process.env.EXPO_PUBLIC_MILANO_SCREEN;
}

export default function App(): ReactNode {
  const screen = requestedScreen();
  const [stack, setStack] = useState<readonly Route[]>(() => {
    const start = initialRoute(screen === "interstitial" ? undefined : screen);
    // An unrecognized screen name lands on the menu rather than on nothing.
    const known = start.kind !== "demo" || DEMOS[start.id] !== undefined;
    if (!known || start.kind === "menu") return [{ kind: "menu" }];
    return [{ kind: "menu" }, start];
  });
  const [interstitial, setInterstitial] = useState(screen === "interstitial");
  const palette = usePalette();
  const scheme = useColorScheme();

  const push = useCallback((route: Route) => setStack((current) => [...current, route]), []);
  const pop = useCallback(
    () => setStack((current) => (current.length > 1 ? current.slice(0, -1) : current)),
    [],
  );
  const dismissInterstitial = useCallback(() => setInterstitial(false), []);

  const route = stack[stack.length - 1] as Route;
  const title = routeTitle(route, (id) => DEMOS[id]?.title ?? id);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ backgroundColor: palette.background, flex: 1 }}>
        <StatusBar style={scheme === "dark" ? "light" : "dark"} />
        <View
          style={{
            alignItems: "center",
            flexDirection: "row",
            gap: 12,
            paddingHorizontal: 16,
            paddingVertical: 12,
          }}
        >
          {stack.length > 1 ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={pop}>
              <Text style={{ color: palette.accent, fontSize: 17 }}>{"‹ Back"}</Text>
            </Pressable>
          ) : null}
          <Text style={{ color: palette.text, fontSize: 20, fontWeight: "700" }}>{title}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <CurrentScreen
            route={route}
            onNavigate={push}
            onPresentInterstitial={() => setInterstitial(true)}
          />
        </View>
        <InterstitialScreen visible={interstitial} onDismiss={dismissInterstitial} />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function CurrentScreen({
  route,
  onNavigate,
  onPresentInterstitial,
}: {
  readonly route: Route;
  readonly onNavigate: (route: Route) => void;
  readonly onPresentInterstitial: () => void;
}): ReactNode {
  switch (route.kind) {
    case "menu":
      return <MenuScreen onNavigate={onNavigate} onPresentInterstitial={onPresentInterstitial} />;
    case "demo": {
      const demo = DEMOS[route.id];
      return demo === undefined ? null : <DemoScreen demo={demo} />;
    }
    case "quickstart":
      return <QuickStartScreen />;
    case "pokemon":
      return <PokemonScreen />;
    case "profile":
      return <ProfileScreen />;
    case "catalog":
      return <CatalogScreen />;
    case "embedded":
      return <EmbeddedScreen />;
  }
}
