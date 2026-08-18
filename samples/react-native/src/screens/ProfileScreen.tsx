import { MilanoValue } from "@get-milano/core";
import { MilanoHost } from "@get-milano/react";
import { useMemo } from "react";
import type { ReactNode } from "react";

import { Failure, Loading, Screen } from "../design-system.tsx";
import { documentBuilder } from "../environment.ts";

/**
 * A whole user-profile screen as one document: identity from context,
 * settings as state, everything below the navigation bar declared in
 * profile.json. The document pins `vocabulary.min: 1.1.0`, so an app
 * holding an older vocabulary fails the build instead of rendering a
 * half-understood profile.
 */
export function ProfileScreen(): ReactNode {
  const builder = useMemo(
    () =>
      documentBuilder("profile", {
        memberSince: MilanoValue.string("March 2024"),
        avatarUrl: MilanoValue.string(
          "https://raw.githubusercontent.com/PokeAPI/sprites/master" +
            "/sprites/pokemon/other/official-artwork/25.png",
        ),
      }),
    [],
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
