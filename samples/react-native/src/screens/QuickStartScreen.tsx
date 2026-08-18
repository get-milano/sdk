import { MilanoValue } from "@get-milano/core";
import { MilanoQuickHost } from "@get-milano/react";
import type { MilanoNodeProps } from "@get-milano/react";
import type { ReactNode } from "react";
import { Pressable, Text } from "react-native";

import { Failure, Loading, Screen, usePalette } from "../design-system.tsx";

/**
 * The quick path end to end: no engine, registry, builder, or providers in
 * sight. One component, an inline vocabulary and document, one renderer,
 * and an action callback. Every other screen goes through the shared
 * environment, the full architecture for real apps.
 *
 * Everything the host passes lives at module scope: `MilanoQuickHost`
 * rebuilds when any of it changes identity.
 */
const VOCABULARY = JSON.stringify({
  milano: "1.0.0",
  name: "quickstart",
  version: "1.0.0",
  components: {
    Greeting: { properties: { text: "string" }, events: { tap: null } },
  },
  actions: { celebrate: {} },
});

const DOCUMENT = JSON.stringify({
  version: "1.0.0",
  context: { userName: "string" },
  state: { taps: "int" },
  root: {
    type: "Greeting",
    id: "hello",
    properties: {
      text: {
        $expr: "concat('Hello, ', context.userName, '! Taps: ', str(state.taps))",
      },
    },
    on: {
      tap: [
        { action: "$set", key: "taps", value: { $expr: "state.taps + 1" } },
        { action: "celebrate" },
      ],
    },
  },
});

function Greeting({ node }: MilanoNodeProps): ReactNode {
  const palette = usePalette();
  return (
    <Pressable accessibilityRole="button" onPress={() => node.emit("tap")} style={{ padding: 24 }}>
      <Text style={{ color: palette.text, fontSize: 22, fontWeight: "600" }}>
        {node.property("text").stringValue ?? ""}
      </Text>
    </Pressable>
  );
}

const RENDERERS = { Greeting } as const;
const CONTEXT = { userName: MilanoValue.string("Ada") } as const;

function celebrate(action: { readonly name: string }): null {
  console.log(`[quickstart] dispatched ${action.name}`);
  return null;
}

export function QuickStartScreen(): ReactNode {
  return (
    <Screen>
      <MilanoQuickHost
        document={DOCUMENT}
        vocabulary={VOCABULARY}
        renderers={RENDERERS}
        context={CONTEXT}
        onAction={celebrate}
        loading={<Loading />}
        failure={(error) => <Failure title="Build failed" detail={String(error)} />}
      />
    </Screen>
  );
}
