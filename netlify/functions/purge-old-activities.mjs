import { getSupabase } from './lib/supabase.mjs';

// Scheduled function — runs daily to purge activities older than 7 days
export default async () => {
  const db = getSupabase();
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await db
    .from('activities')
    .delete()
    .lt('start_date', cutoff)
    .select('id');

  const count = data?.length || 0;
  console.log(`Purged ${count} activities older than 7 days`);

  if (error) {
    console.error('Purge error:', error);
  }

  return new Response(JSON.stringify({ purged: count }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

export const config = {
  schedule: '0 3 * * *', // Daily at 3am UTC
};
