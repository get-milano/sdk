import { MilanoHost } from "@get-milano/react";
import { useMemo } from "react";
import type { ReactNode } from "react";

import { Failure, Loading, Screen } from "../design-system.tsx";
import { catalogBuilder } from "../environment.ts";

/**
 * An intermediate screen, catalog-style, as one document: a `$repeat` over
 * the items the state data provider supplies, each instance a card bound
 * to `tap` -> `openUrl` with the item's own page, opened through the host's
 * action handler.
 */
export function CatalogScreen(): ReactNode {
  const builder = useMemo(() => catalogBuilder(), []);
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
