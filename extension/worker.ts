import { classify, invalidate } from "./classifier";
self.onmessage = async ({ data }) => {
  if (data.refresh) {
    invalidate();
    return;
  }
  try {
    self.postMessage({
      id: data.id,
      result: await classify(data.input, new URL("vector.wasm", location.href).href),
    });
  } catch {
    self.postMessage({ id: data.id, result: { error: true } });
  }
};
