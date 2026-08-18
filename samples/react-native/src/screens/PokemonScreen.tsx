import { MilanoValue } from "@get-milano/core";
import { MilanoHost } from "@get-milano/react";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { Failure, Loading, Screen } from "../design-system.tsx";
import { documentBuilder } from "../environment.ts";

type ScreenContext = Readonly<Record<string, MilanoValue>>;

/**
 * One MilanoHost, two context sources: the app-wide shared context (the
 * trainer name) plus screen-specific values fetched from PokeAPI and
 * injected into this screen's builder. The document declares all four
 * keys; the gate validates them together at build.
 */
export function PokemonScreen(): ReactNode {
  const [context, setContext] = useState<ScreenContext | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  // The screen owns its data: fetched before the document is built, then
  // handed to Milano as plain context values.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("https://pokeapi.co/api/v2/pokemon/pikachu");
        const payload = (await response.json()) as {
          name?: string;
          height?: number;
          weight?: number;
          sprites?: { other?: { "official-artwork"?: { front_default?: string } } };
        };
        const imageUrl = payload.sprites?.other?.["official-artwork"]?.front_default;
        if (
          payload.name === undefined ||
          payload.height === undefined ||
          payload.weight === undefined ||
          imageUrl === undefined
        ) {
          if (!cancelled) setFailure("unexpected PokeAPI payload");
          return;
        }
        if (cancelled) return;
        setContext({
          pokemonName: MilanoValue.string(payload.name),
          pokemonHeight: MilanoValue.double(payload.height),
          pokemonWeight: MilanoValue.double(payload.weight),
          pokemonImageUrl: MilanoValue.string(imageUrl),
        });
      } catch (error) {
        if (!cancelled) setFailure(String(error));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const builder = useMemo(
    () => (context === null ? null : documentBuilder("pokemon", context)),
    [context],
  );

  if (failure !== null) return <Failure title="Fetch failed" detail={failure} />;
  if (builder === null) return <Loading label="Fetching from PokeAPI…" />;
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
