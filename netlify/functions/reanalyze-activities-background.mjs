// Background function to re-analyze recent activities with the new ride analysis engine.
// Fetches Strava streams for each activity, runs analyzeRide(), updates enrichment_data,
// and regenerates commentary with the richer context.

import { getSupabase } from './lib/supabase.mjs';
import { analyzeRide } from './lib/ride-analysis.mjs';
import { getActivityStreams, normalizeStreams } from './lib/strava.mjs';
import { generateRoast } from './lib/claude.mjs';

export default async (req) => {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.ADMIN_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const days = body.days || 7;
  const regenerateCommentary = body.regenerateCommentary !== false; // default true

  const db = getSupabase();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  // Fetch recent activities that have a Strava source
  const { data: activities, error } = await db
    .from('activities')
    .select('id, platform_links, average_watts, user_id, name, distance, moving_time, elapsed_time, elevation_gain, average_speed, max_speed, sport_type, start_date, average_watts, max_watts, suffer_score, normalized_power, avg_cadence, max_cadence, avg_heart_rate, max_heart_rate, calories, lap_data, enrichment_data, route_polyline')
    .gte('start_date', since)
    .order('start_date', { ascending: false });

  if (error) {
    console.error('Failed to fetch activities:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  console.log(`Found ${activities.length} activities from the past ${days} days`);

  // Get user data (FTP, weight) for analysis options
  const userIds = [...new Set(activities.map(a => a.user_id).filter(Boolean))];
  const { data: users } = await db
    .from('users')
    .select('id, ftp, weight, height, display_name')
    .in('id', userIds);
  const userMap = Object.fromEntries((users || []).map(u => [u.id, u]));

  // Get Strava athlete IDs from platform_connections
  const { data: connections } = await db
    .from('platform_connections')
    .select('user_id, platform_user_id')
    .eq('platform', 'strava')
    .in('user_id', userIds);
  const athleteMap = Object.fromEntries((connections || []).map(c => [c.user_id, c.platform_user_id]));

  // Also check legacy athletes table
  const { data: legacyAthletes } = await db
    .from('athletes')
    .select('id, user_id')
    .in('user_id', userIds);
  for (const la of legacyAthletes || []) {
    if (!athleteMap[la.user_id]) athleteMap[la.user_id] = String(la.id);
  }

  const results = { analyzed: 0, skipped: 0, failed: 0, commentary_regenerated: 0, details: [] };

  for (const activity of activities) {
    const stravaId = activity.platform_links?.strava;
    if (!stravaId) {
      results.skipped++;
      results.details.push({ id: activity.id, status: 'skipped', reason: 'no_strava_source' });
      continue;
    }

    const user = userMap[activity.user_id];
    const athleteId = athleteMap[activity.user_id];
    if (!athleteId) {
      results.skipped++;
      results.details.push({ id: activity.id, status: 'skipped', reason: 'no_athlete_id' });
      continue;
    }

    try {
      console.log(`Analyzing activity ${activity.id} (Strava ${stravaId})...`);

      // Fetch all streams from Strava
      const rawStreams = await getActivityStreams(athleteId, stravaId);
      if (!rawStreams) {
        results.skipped++;
        results.details.push({ id: activity.id, status: 'skipped', reason: 'no_streams' });
        continue;
      }

      const streams = normalizeStreams(rawStreams);
      if (!streams?.time?.length) {
        results.skipped++;
        results.details.push({ id: activity.id, status: 'skipped', reason: 'empty_streams' });
        continue;
      }

      // Run ride analysis
      const analysisOptions = { ftp: user?.ftp, weight: user?.weight };
      const rideAnalysis = analyzeRide(streams, analysisOptions);
      if (!rideAnalysis) {
        results.skipped++;
        results.details.push({ id: activity.id, status: 'skipped', reason: 'analysis_returned_null' });
        continue;
      }

      // Merge with existing enrichment_data
      const enrichmentActivity = {
        ...activity,
        ride_analysis: rideAnalysis,
        power_analysis: rideAnalysis.power || activity.enrichment_data,
        power_curve: rideAnalysis.power?.best_efforts,
      };

      const updates = {
        enrichment_data: buildEnrichmentData(enrichmentActivity),
      };

      if (rideAnalysis.power?.normalized_power) {
        updates.normalized_power = Math.round(rideAnalysis.power.normalized_power);
      }

      await db.from('activities').update(updates).eq('id', activity.id);
      results.analyzed++;

      // Regenerate commentary with richer context
      if (regenerateCommentary) {
        try {
          const activityForRoast = { ...activity, ...updates, ride_analysis: rideAnalysis };
          if (user?.weight) activityForRoast.athlete_weight = user.weight;
          if (user?.height) activityForRoast.athlete_height = user.height;
          if (user?.ftp) activityForRoast.athlete_ftp = user.ftp;

          const roast = await generateRoast(activityForRoast, {
            firstname: user?.display_name?.split(' ')[0] || '?',
            lastname: user?.display_name?.split(' ').slice(1).join(' ') || '',
          });
          await db.from('activities').update({
            roast,
            roast_generated_at: new Date().toISOString(),
          }).eq('id', activity.id);
          results.commentary_regenerated++;
          console.log(`Activity ${activity.id}: analyzed + commentary regenerated`);
        } catch (err) {
          console.error(`Commentary regen failed for ${activity.id}:`, err.message);
        }
      }

      results.details.push({ id: activity.id, status: 'analyzed', climbs: rideAnalysis.climbs?.length || 0, segments: rideAnalysis.segments?.length || 0 });
    } catch (err) {
      console.error(`Failed to analyze activity ${activity.id}:`, err.message);
      results.failed++;
      results.details.push({ id: activity.id, status: 'failed', error: err.message });
    }
  }

  console.log(`Reanalysis complete: ${results.analyzed} analyzed, ${results.skipped} skipped, ${results.failed} failed, ${results.commentary_regenerated} commentary regenerated`);

  return new Response(JSON.stringify(results), {
    headers: { 'Content-Type': 'application/json' },
  });
};

// Duplicated from activity.mjs to keep this function self-contained
function buildEnrichmentData(activity) {
  const data = {};
  if (activity.power_curve) data.best_efforts = activity.power_curve;
  if (activity.power_analysis) {
    if (activity.power_analysis.best_efforts) data.best_efforts = activity.power_analysis.best_efforts;
    if (activity.power_analysis.variability_index) data.variability_index = activity.power_analysis.variability_index;
    if (activity.power_analysis.intensity_factor) data.intensity_factor = activity.power_analysis.intensity_factor;
    if (activity.power_analysis.tss) data.tss = activity.power_analysis.tss;
    if (activity.power_analysis.intervals) data.intervals = activity.power_analysis.intervals;
  }
  const ra = activity.ride_analysis;
  if (ra) {
    if (ra.power) {
      if (ra.power.best_efforts) data.best_efforts = ra.power.best_efforts;
      if (ra.power.variability_index) data.variability_index = ra.power.variability_index;
      if (ra.power.intensity_factor) data.intensity_factor = ra.power.intensity_factor;
      if (ra.power.tss) data.tss = ra.power.tss;
      if (ra.power.intervals) data.intervals = ra.power.intervals;
      if (ra.power.normalized_power) data.normalized_power = ra.power.normalized_power;
    }
    if (ra.climbs?.length) data.climbs = ra.climbs;
    if (ra.segments?.length) data.segments = ra.segments;
    if (ra.wprime) data.wprime = ra.wprime;
    if (ra.hr_analysis) data.hr_analysis = ra.hr_analysis;
    if (ra.pacing) data.pacing = ra.pacing;
  }
  return Object.keys(data).length > 0 ? data : null;
}
