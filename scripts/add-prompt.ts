import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getDb } from '../src/lib/db';

// Usage: npm run prompt:add -- <id> <path> [--notes "..."]
async function main() {
  const args = process.argv.slice(2);
  const notesIdx = args.indexOf('--notes');
  const notes = notesIdx !== -1 ? args[notesIdx + 1] : undefined;
  if (notesIdx !== -1 && notes === undefined) throw new Error('--notes requires a value');
  const positional = args.filter((_, i) => i !== notesIdx && i !== notesIdx + 1);
  const [id, path] = positional;
  if (!id || !path) throw new Error('Usage: npm run prompt:add -- <id> <path> [--notes "..."]');

  let content: string;
  try {
    content = readFileSync(resolve(process.cwd(), path), 'utf8');
  } catch {
    throw new Error(`Cannot read prompt file: ${path}`);
  }
  if (!content.trim()) throw new Error(`Prompt file is empty: ${path}`);

  const db = getDb();
  const { data: existing, error: lookupError } = await db.from('prompt_versions').select('id').eq('id', id).maybeSingle();
  if (lookupError) throw new Error(lookupError.message);
  if (existing) throw new Error(`Prompt version "${id}" already exists`);

  const { error } = await db.from('prompt_versions').insert({ id, content, status: 'draft', notes: notes ?? null });
  if (error) throw new Error(error.message);
  console.log(`Added prompt ${id} as draft (${content.length} chars)`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
