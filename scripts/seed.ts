import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getDb } from '../src/lib/db';

const root = resolve(__dirname, '..');
const reset = process.argv.includes('--reset');

async function main() {
  const db = getDb();

  if (reset) {
    // Children first (foreign keys), then clear chaos below.
    for (const table of ['spans', 'refunds', 'tickets', 'alerts']) {
      const { error } = await db.from(table).delete().not('id', 'is', null);
      if (error) throw new Error(`reset ${table}: ${error.message}`);
    }
    console.log('Reset: deleted spans, refunds, tickets, alerts');
  }

  const orders = JSON.parse(readFileSync(resolve(root, 'spec/seed/orders.json'), 'utf8'));
  const { error: ordersError } = await db.from('orders').upsert(orders, { onConflict: 'id' });
  if (ordersError) throw new Error(`orders upsert: ${ordersError.message}`);

  const chaos = reset
    ? await db.from('chaos_config').upsert({ id: 1, mode: 'none', updated_at: new Date().toISOString() })
    : await db.from('chaos_config').upsert({ id: 1 }, { onConflict: 'id', ignoreDuplicates: true });
  if (chaos.error) throw new Error(`chaos_config: ${chaos.error.message}`);

  const { data: v1, error: v1Error } = await db
    .from('prompt_versions')
    .select('id')
    .eq('id', 'v1')
    .maybeSingle();
  if (v1Error) throw new Error(`prompt_versions lookup: ${v1Error.message}`);
  if (!v1) {
    const content = readFileSync(resolve(root, 'prompts/v1.md'), 'utf8');
    const { error } = await db
      .from('prompt_versions')
      .insert({ id: 'v1', content, status: 'live', notes: 'baseline', promoted_at: new Date().toISOString() });
    if (error) throw new Error(`insert v1: ${error.message}`);
    console.log('Inserted prompt v1 as live');
  }

  const { count: orderCount } = await db.from('orders').select('*', { count: 'exact', head: true });
  const { data: live } = await db.from('prompt_versions').select('id').eq('status', 'live');
  const { data: chaosRow } = await db.from('chaos_config').select('mode').eq('id', 1).single();

  console.log(`Orders: ${orderCount}`);
  console.log(`Live prompt: ${live?.map((p) => p.id).join(', ') ?? 'none'}`);
  console.log(`Chaos mode: ${chaosRow?.mode}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
