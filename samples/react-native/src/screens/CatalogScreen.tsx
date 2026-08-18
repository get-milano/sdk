import { MilanoHost } from "@get-milano/react";
import { useMemo } from "react";
import type { ReactNode } from "react";

import { Failure, Loading, Screen } from "../design-system.tsx";
import { documentBuilder } from "../environment.ts";

/**
 * An intermediate screen, catalog-style, as one document: a list of item
 * cards (documents are data, so a producer enumerates them), each bound to
 * `tap` -> `openUrl`, so tapping an item opens its page through the host's
 * action handler.
 */
export function CatalogScreen(): ReactNode {
  const builder = useMemo(() => documentBuilder("catalog"), []);
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
