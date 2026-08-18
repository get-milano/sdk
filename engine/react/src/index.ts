/**
 * Milano for React: the host component and the renderer surface. This
 * package imports only `react`, so the same binding serves React Native
 * and the web; the platform primitives live in your renderers.
 */
export { createMilanoRegistry, MilanoNode, MilanoUnknownNode, renderNode } from "./node.ts";
export type {
  MilanoNodeProps,
  MilanoPlaceholderRenderer,
  MilanoReactRegistry,
  MilanoRenderer,
  MilanoUnknownNodeProps,
} from "./node.ts";

export { MilanoHost, MilanoQuickHost, MilanoRenderedView, useMilanoView } from "./host.ts";
export type {
  MilanoHostProps,
  MilanoQuickHostProps,
  MilanoReactBuilder,
  MilanoRenderedViewProps,
  MilanoViewState,
} from "./host.ts";
