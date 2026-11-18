import { events } from "./db";
import { kernel, shouldHide } from "../shared/model";
export type Query = { text: string; context: string; progress: number | null };
let cached: ReturnType<typeof events> | undefined;
let wasm: ReturnType<typeof kernel> | undefined;
export function invalidate() {
  cached = undefined;
}
export async function classify(input: Query, asset: string) {
  const [catalog, engine] = await Promise.all([
    (cached ??= events()),
    (wasm ??= fetch(asset)
      .then((r) => r.arrayBuffer())
      .then(kernel)),
  ]);
  return { hide: shouldHide(input.text, input.context, catalog, input.progress, engine) };
}
