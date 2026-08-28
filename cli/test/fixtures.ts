export const VOCABULARY = JSON.stringify({
  milano: "1.0.0",
  name: "fixture",
  version: "1.0.0",
  components: {
    Column: { children: true },
    Text: { properties: { text: "string" } },
    Button: { properties: { label: "string" }, events: { tap: null } },
  },
  actions: { submit: { parameters: { id: "string" } } },
});

export function document(root: unknown, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ version: "1.0.0", ...extra, root });
}

export const VALID = document({ type: "Text", id: "t", properties: { text: "hello" } });
