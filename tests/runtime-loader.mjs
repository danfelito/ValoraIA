import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("jsr:")) return {url:"data:text/javascript,export%20{}",shortCircuit:true};
  if (specifier.startsWith("npm:pdf-lib")) return {url:pathToFileURL(require.resolve("pdf-lib",{paths:[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES]})).href,shortCircuit:true};
  if (specifier.startsWith("npm:@supabase/supabase-js")) return {url:"data:text/javascript,export%20const%20createClient%20%3D%20()%20%3D%3E%20globalThis.__fakeDB",shortCircuit:true};
  return nextResolve(specifier,context);
}
