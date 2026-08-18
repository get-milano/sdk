import { MilanoHost } from "@get-milano/react";
import { useMemo } from "react";
import type { ReactNode } from "react";

import { NativeCard, NativeCarousel, Screen } from "../design-system.tsx";
import { documentBuilder } from "../environment.ts";

/**
 * Milano as an embedded fragment: a native card, a Milano banner, and a
 * native carousel sharing one screen. The Milano subtree is just another
 * view in the hierarchy, and a build failure leaves the native content
 * untouched.
 */
export function EmbeddedScreen(): ReactNode {
  const builder = useMemo(() => documentBuilder("banner-strip"), []);
  return (
    <Screen>
      <NativeCard title="Your balance" detail="$1,240.50 · updated just now" />
      <MilanoHost builder={builder} loading={null} failure={() => null} />
      <NativeCarousel />
    </Screen>
  );
}
