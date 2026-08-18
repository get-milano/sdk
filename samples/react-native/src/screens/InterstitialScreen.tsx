import { MilanoHost } from "@get-milano/react";
import { useMemo } from "react";
import type { ReactNode } from "react";
import { Modal } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Failure, Loading, Screen } from "../design-system.tsx";
import { interstitialBuilder } from "../environment.ts";

/**
 * A full-screen Milano takeover. The document declares a `dismiss` action;
 * the host decides what dismissal means, which here is closing the modal.
 * The takeover is mounted only while it is presented, so the document is
 * built on presentation and torn down on dismissal.
 */
export function InterstitialScreen({
  visible,
  onDismiss,
}: {
  readonly visible: boolean;
  readonly onDismiss: () => void;
}): ReactNode {
  if (!visible) return null;
  return (
    <Modal visible animationType="slide" onRequestClose={onDismiss}>
      <Takeover onDismiss={onDismiss} />
    </Modal>
  );
}

function Takeover({ onDismiss }: { readonly onDismiss: () => void }): ReactNode {
  const builder = useMemo(() => interstitialBuilder(onDismiss), [onDismiss]);
  // A modal is presented outside the app's own safe area, so the takeover
  // brings its own: without it the hero starts under the notch.
  return (
    <SafeAreaView edges={["top", "bottom"]} style={{ flex: 1 }}>
      <Screen>
        <MilanoHost
          builder={builder}
          loading={<Loading />}
          failure={(error) => <Failure title="Build failed" detail={String(error)} />}
        />
      </Screen>
    </SafeAreaView>
  );
}
