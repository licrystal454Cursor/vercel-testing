import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const TTL_HOURS = 24;

export async function getCachedDoc(url: string): Promise<unknown | null> {
  const { data } = await supabase
    .from('stripe_docs_cache')
    .select('content, cached_at')
    .eq('url', url)
    .single();

  if (!data) return null;

  const ageHours = (Date.now() - new Date(data.cached_at).getTime()) / 3_600_000;
  if (ageHours > TTL_HOURS) return null;

  console.log('[docs-cache] hit | age:', Math.round(ageHours * 10) / 10, 'hrs |', url);
  return data.content;
}

export async function setCachedDoc(url: string, content: unknown): Promise<void> {
  await supabase
    .from('stripe_docs_cache')
    .upsert({ url, content, cached_at: new Date().toISOString() });
}
