import { MilanoHost } from "@get-milano/react";
import type { MilanoReactBuilder } from "@get-milano/react";
import { useMemo } from "react";
import type { ReactNode } from "react";

import { Failure, Loading, Screen } from "../design-system.tsx";
import type { DocumentName } from "../documents.generated.ts";
import { documentBuilder, formBuilder } from "../environment.ts";

/** One demo: a document, a title, and the builder that materializes it. */
export interface Demo {
  readonly id: string;
  readonly title: string;
  readonly makeBuilder: () => MilanoReactBuilder;
}

function fromResource(id: string, title: string, resource: DocumentName): Demo {
  return { id, title, makeBuilder: () => documentBuilder(resource) };
}

export const DEMOS: Readonly<Record<string, Demo>> = {
  banner: fromResource("banner", "Banner · Overlay", "banner"),
  "banner-card": fromResource("banner-card", "Banner · Card", "banner-card"),
  "banner-strip": fromResource("banner-strip", "Banner · Strip", "banner-strip"),
  form: { id: "form", title: "Contact form", makeBuilder: formBuilder },
  "tip-calculator": fromResource("tip-calculator", "Tip calculator", "tip-calculator"),
  "checkbox-gate": fromResource("checkbox-gate", "Checkbox gate", "checkbox-gate"),
};

/**
 * One demo screen: the builder is memoized on the demo, because a new
 * builder means a new build. Entering the screen builds the view, so the
 * loading content is visible every time.
 */
export function DemoScreen({ demo }: { readonly demo: Demo }): ReactNode {
  const builder = useMemo(() => demo.makeBuilder(), [demo]);
  return (
    <Screen>
      <MilanoHost
        builder={builder}
        loading={<Loading label="Building…" />}
        failure={(error) => <Failure title="Build failed" detail={String(error)} />}
      />
    </Screen>
  );
}
