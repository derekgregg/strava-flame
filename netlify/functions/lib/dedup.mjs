import { getSupabase } from './supabase.mjs';

// Generate a dedup fingerprint from activity characteristics.
// Tolerances: start time rounded to nearest minute, duration to nearest minute,
// distance to nearest 100m. This handles minor platform discrepancies.
export function computeDedupKey(activity) {
  const startMs = new Date(activity.start_date).getTime();
  const startMinute = Math.floor(startMs / 60000);
  const distanceHecto = Math.round((activity.distance || 0) / 100);

  return `${startMinute}:${distanceHecto}`;
}

// Check if an activity already exists for this user.
// Returns the existing activity row if found, null otherwise.
//
// Strategy:
// 1. Check platform_links — does this exact platform:id already exist?
// 2. Dedup key match — same fingerprint for this user
// 3. Fuzzy time/distance overlap — start within 2min, duration/distance within 10%
export async function findDuplicate(userId, activity, platform, platformActivityId) {
  const db = getSupabase();

  // Layer 1: This exact source already linked to an activity
  if (platformActivityId) {
    // Check platform_links JSONB for this platform:id
    const { data } = await db
      .from('activities')
      .select('id')
      .eq('user_id', userId)
      .contains('platform_links', { [platform]: platformActivityId })
      .single();
    if (data) return { ...data, reason: 'same_source' };

    // Fallback: check source_platform + source_activity_id columns
    const { data: legacy } = await db
      .from('activities')
      .select('id')
      .eq('source_platform', platform)
      .eq('source_activity_id', platformActivityId)
      .single();
    if (legacy) return { ...legacy, reason: 'same_source' };
  }

  // Layer 2: Dedup key match (same user, different source)
  const dedupKey = computeDedupKey(activity);
  if (dedupKey && userId) {
    const { data } = await db
      .from('activities')
      .select('id')
      .eq('user_id', userId)
      .eq('dedup_key', dedupKey)
      .single();
    if (data) {
      // Check if this source is already linked
      const { data: full } = await db
        .from('activities')
        .select('id, platform_links')
        .eq('id', data.id)
        .single();
      if (full?.platform_links?.[platform] === platformActivityId) {
        return { ...full, reason: 'same_source' };
      }
      return { ...data, reason: 'dedup_key' };
    }
  }

  // Layer 3: Fuzzy time/distance overlap
  if (activity.start_date && userId) {
    const startMs = new Date(activity.start_date).getTime();
    const windowStart = new Date(startMs - 2 * 60000).toISOString();
    const windowEnd = new Date(startMs + 2 * 60000).toISOString();

    const { data: candidates } = await db
      .from('activities')
      .select('id, distance')
      .eq('user_id', userId)
      .gte('start_date', windowStart)
      .lte('start_date', windowEnd);

    if (candidates) {
      for (const c of candidates) {
        // Match on distance only (within 15%) — duration is unreliable
        // across platforms (Strava excludes stopped time, Garmin doesn't)
        const distanceMatch = !activity.distance || !c.distance ||
          Math.abs(activity.distance - c.distance) / Math.max(activity.distance, c.distance) < 0.15;
        if (distanceMatch) {
          return { ...c, reason: 'fuzzy_match' };
        }
      }
    }
  }

  return null;
}
