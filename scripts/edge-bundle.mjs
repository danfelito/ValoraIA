import {readFile} from 'node:fs/promises';
import path from 'node:path';
const entry = `supabase/functions/${process.argv[2]}/index.ts`, files = new Map();
async function visit(name) {
  if (files.has(name)) return;
  const content = await readFile(name,'utf8'); files.set(name,content);
  for (const [,relative] of content.matchAll(/(?:from\s*|import\s*)["'](\.[^"']+)["']/g)) {
    const next=path.posix.normalize(path.posix.join(path.posix.dirname(name),relative));
    if (!next.startsWith('supabase/functions/')) throw new Error('Unexpected dependency path');
    await visit(next);
  }
}
await visit(entry);
process.stdout.write(JSON.stringify({entrypoint_path:entry,files:[...files].map(([name,content])=>({name,content}))}));
