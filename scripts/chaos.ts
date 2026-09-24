import { getDb } from '../src/lib/db';

const MODES = ['none', 'latency', 'errors'] as const;

// Usage: npm run chaos -- none|latency|errors
async function main() {
  const mode = process.argv[2];
  if (!MODES.includes(mode as (typeof MODES)[number])) {
    throw new Error(`Usage: npm run chaos -- ${MODES.join('|')}`);
  }
  const { error } = await getDb()
    .from('chaos_config')
    .upsert({ id: 1, mode, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Could not update chaos_config: ${error.message}`);
  console.log(`Chaos mode set to: ${mode}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
