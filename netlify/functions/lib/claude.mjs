import Anthropic from '@anthropic-ai/sdk';

let client;

function getClient() {
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatDistance(meters) {
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(2)}km`;
}

function formatSpeed(mps) {
  return `${(mps * 3.6).toFixed(1)} km/h`;
}

function buildPrompt(activity, athlete) {
  const stats = [];
  stats.push(`Activity type: ${activity.sport_type}`);
  stats.push(`Name: "${activity.name}"`);
  if (activity.distance > 0) stats.push(`Distance: ${formatDistance(activity.distance)}`);
  stats.push(`Moving time: ${formatDuration(activity.moving_time)}`);
  stats.push(`Elapsed time: ${formatDuration(activity.elapsed_time)}`);
  if (activity.total_elevation_gain > 0) stats.push(`Elevation gain: ${activity.total_elevation_gain}m`);
  if (activity.average_speed > 0) stats.push(`Average speed: ${formatSpeed(activity.average_speed)}`);
  if (activity.max_speed > 0) stats.push(`Max speed: ${formatSpeed(activity.max_speed)}`);
  if (activity.average_watts) stats.push(`Average watts: ${activity.average_watts}W`);
  if (activity.max_watts) stats.push(`Max watts: ${activity.max_watts}W`);
  if (activity.suffer_score) stats.push(`Suffer score: ${activity.suffer_score}`);

  const timeDiff = activity.elapsed_time - activity.moving_time;
  if (timeDiff > 60) stats.push(`Time spent stopped: ${formatDuration(timeDiff)}`);

  return `You are a brutally funny sports commentator who roasts athletes' workout data. Your job is to generate a savage, hilarious roast of this activity. Be creative, specific to the stats, and merciless. Reference the actual numbers to make the roast sting.

Rules:
- Keep it to 2-3 sentences max
- Be funny and creative, not just mean
- Reference specific stats that are weak or funny
- Short walks, low distances, and slow speeds deserve EXTRA savage treatment
- If someone stopped a lot (big gap between moving and elapsed time), roast them for it
- If the activity name is funny or tryhard, roast that too
- Low suffer scores mean they weren't even trying
- Don't use hashtags or emojis

Athlete: ${athlete.firstname} ${athlete.lastname}
${stats.join('\n')}

Generate a single roast:`;
}

export async function generateRoast(activity, athlete) {
  const prompt = buildPrompt(activity, athlete);

  const response = await getClient().messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 256,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.content[0].text.trim();
}
