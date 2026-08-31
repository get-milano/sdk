import { MilanoHost } from "@get-milano/react";
import { useMemo } from "react";
import type { ReactNode } from "react";

import { Failure, Loading, Screen } from "../design-system.tsx";
import { quickActionsBuilder } from "../environment.ts";
import type { Route } from "../routes.ts";

/**
 * A horizontal strip of tiles from one `$repeat` template: each tap
 * records the tapped tile's position through the repeat's index binding
 * and then asks the host to push a screen. The document never names a
 * route object or a glyph; it names a declared screen and a declared
 * icon, and this host decides what both mean.
 */
export function QuickActionsScreen({
  onNavigate,
}: {
  readonly onNavigate: (route: Route) => void;
}): ReactNode {
  // The screen name is a declared enum member, so the gate has already
  // proved it is one of four; this maps it onto the sample's own routes.
  const builder = useMemo(
    () =>
      quickActionsBuilder((screen) => {
        switch (screen) {
          case "profile":
            return onNavigate({ kind: "profile" });
          case "catalog":
            return onNavigate({ kind: "catalog" });
          case "pokemon":
            return onNavigate({ kind: "pokemon" });
          default:
            return onNavigate({ kind: "demo", id: "form" });
        }
      }),
    [onNavigate],
  );
  return (
    <Screen>
      <MilanoHost
        builder={builder}
        loading={<Loading />}
        failure={(error) => <Failure title="Build failed" detail={String(error)} />}
      />
    </Screen>
  );
}
