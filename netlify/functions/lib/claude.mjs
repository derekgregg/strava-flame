import Anthropic from '@anthropic-ai/sdk';

let client;

function getClient() {
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

function fmt(n) {
  return Math.round(n).toLocaleString('en-US');
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
  if (meters < 1000) return `${fmt(meters)} m`;
  return `${(meters / 1000).toFixed(2)} km`;
}

function formatSpeed(mps) {
  return `${(mps * 3.6).toFixed(1)} km/h`;
}

function buildPrompt(activity, athlete) {
  const stats = [];
  stats.push(`Activity type: ${activity.sport_type}`);
  if (activity.name) stats.push(`Name: "${activity.name}"`);
  if (activity.description) stats.push(`Athlete's description: "${activity.description}"`);
  if (activity.distance > 0) stats.push(`Distance: ${formatDistance(activity.distance)}`);
  stats.push(`Moving time: ${formatDuration(activity.moving_time)}`);
  stats.push(`Elapsed time: ${formatDuration(activity.elapsed_time)}`);
  if (activity.total_elevation_gain > 0) stats.push(`Elevation gain: ${fmt(activity.total_elevation_gain)} m`);
  if (activity.average_speed > 0) stats.push(`Average speed: ${formatSpeed(activity.average_speed)}`);
  if (activity.max_speed > 0) stats.push(`Max speed: ${formatSpeed(activity.max_speed)}`);
  if (activity.average_watts) stats.push(`Average watts: ${fmt(activity.average_watts)} W`);
  if (activity.max_watts) stats.push(`Max watts: ${fmt(activity.max_watts)} W`);
  if (activity.suffer_score) stats.push(`Suffer score: ${fmt(activity.suffer_score)}`);
  if (activity.normalized_power) stats.push(`Normalized power: ${fmt(activity.normalized_power)} W`);
  if (activity.avg_cadence) stats.push(`Average cadence: ${activity.avg_cadence} rpm`);
  if (activity.average_heartrate) stats.push(`Average HR: ${activity.average_heartrate} bpm`);
  if (activity.max_heartrate) stats.push(`Max HR: ${activity.max_heartrate} bpm`);
  if (activity.calories) stats.push(`Calories: ${fmt(activity.calories)}`);

  // Best power efforts
  const bestEfforts = activity.power_analysis?.best_efforts || activity.power_curve;
  if (bestEfforts) {
    const effortLabels = [
      ['5s', '5s'], ['15s', '15s'], ['30s', '30s'], ['1min', '1min'], ['3min', '3min'],
      ['5min', '5min'], ['8min', '8min'], ['10min', '10min'], ['15min', '15min'],
      ['20min', '20min'], ['30min', '30min'], ['45min', '45min'], ['60min', '60min'], ['90min', '90min'],
    ];
    const peaks = effortLabels
      .filter(([key]) => bestEfforts[key])
      .map(([key, label]) => `${label}: ${fmt(bestEfforts[key])} W`);
    if (peaks.length) stats.push(`Best efforts: ${peaks.join(', ')}`);
  }

  // Power metrics
  if (activity.power_analysis?.variability_index) {
    stats.push(`Variability Index: ${activity.power_analysis.variability_index} (${activity.power_analysis.variability_index > 1.05 ? 'surgy/uneven' : 'steady'})`);
  }
  if (activity.power_analysis?.tss) {
    stats.push(`Training Stress Score: ${activity.power_analysis.tss}`);
  }

  // Interval detection (enhanced or legacy)
  const intervals = activity.ride_analysis?.power?.intervals || activity.power_analysis?.intervals;
  if (intervals) {
    const ints = intervals;
    const intDetails = ints.map((iv, i) => {
      let desc = `#${i + 1}: ${formatDuration(iv.duration)} @ ${fmt(iv.avg_power)} W`;
      if (iv.pct_ftp) desc += ` (${iv.pct_ftp}% FTP)`;
      else if (iv.pct_avg) desc += ` (${iv.pct_avg}% of ride avg)`;
      if (iv.type) desc += ` [${iv.type}]`;
      if (iv.fatigue_pct != null && iv.fatigue_pct !== 0) desc += ` fade: ${iv.fatigue_pct > 0 ? '+' : ''}${iv.fatigue_pct}%`;
      if (iv.avg_hr) desc += ` HR: ${iv.avg_hr}`;
      return desc;
    });
    stats.push(`Detected ${ints.length} intervals: ${intDetails.join(', ')}`);
  }

  // Climb detection
  const climbs = activity.ride_analysis?.climbs;
  if (climbs?.length) {
    const climbDetails = climbs.map((c, i) => {
      let desc = `${c.category_label} climb: ${formatDistance(c.distance)} @ ${c.avg_gradient}% avg (${c.max_gradient}% max), +${c.elevation_gain}m`;
      if (c.avg_power) desc += `, ${fmt(c.avg_power)} W`;
      if (c.normalized_power) desc += ` (NP: ${fmt(c.normalized_power)} W)`;
      if (c.vam) desc += `, VAM ${fmt(c.vam)}`;
      if (c.avg_hr) desc += `, HR ${c.avg_hr}`;
      if (c.avg_speed) desc += `, ${formatSpeed(c.avg_speed)}`;
      return desc;
    });
    stats.push(`Climbs: ${climbDetails.join(' | ')}`);
  }

  // Ride segmentation
  const segments = activity.ride_analysis?.segments;
  if (segments?.length) {
    const segSummary = segments.map(s => {
      let desc = `${s.type} (${formatDuration(s.duration)}`;
      if (s.avg_power) desc += ` @ ${fmt(s.avg_power)} W`;
      desc += ')';
      return desc;
    }).join(' → ');
    stats.push(`Ride structure: ${segSummary}`);
  }

  // W'bal
  const wprime = activity.ride_analysis?.wprime;
  if (wprime) {
    let wDesc = `Anaerobic reserves: dropped to ${wprime.min_balance_pct}% W'bal at ${formatDuration(wprime.min_balance_time)}`;
    if (wprime.depletion_count > 0) wDesc += `, ${wprime.depletion_count} deep digs below 25%`;
    if (wprime.near_empty_seconds > 0) wDesc += `, ${wprime.near_empty_seconds}s near empty (<10%)`;
    stats.push(wDesc);
  }

  // HR analysis
  const hrAnalysis = activity.ride_analysis?.hr_analysis;
  if (hrAnalysis) {
    const zoneSummary = hrAnalysis.zones
      .filter(z => z.pct > 0)
      .map(z => `Z${z.zone}: ${z.pct}%`)
      .join(', ');
    if (zoneSummary) stats.push(`HR zones: ${zoneSummary}`);
    if (hrAnalysis.drift) {
      const driftDir = hrAnalysis.drift.drift_pct > 0 ? 'decoupling (fatigue)' : 'improving efficiency';
      stats.push(`Cardiac drift: ${hrAnalysis.drift.drift_pct}% ${driftDir}`);
    }
  }

  // Pacing analysis
  const pacing = activity.ride_analysis?.pacing;
  if (pacing) {
    const pacingNotes = [];
    if (pacing.negative_split) pacingNotes.push('negative split (stronger second half)');
    if (pacing.fade_pct != null && Math.abs(pacing.fade_pct) > 3) {
      pacingNotes.push(`${pacing.fade_pct > 0 ? '' : '-'}${Math.abs(pacing.fade_pct)}% power fade`);
    }
    if (pacing.power_gradient_correlation != null) {
      const desc = pacing.power_gradient_correlation > 0.2 ? 'pushed hard uphill' :
        pacing.power_gradient_correlation < -0.2 ? 'eased off on climbs' : 'even effort regardless of terrain';
      pacingNotes.push(`power-gradient: ${pacing.power_gradient_correlation} (${desc})`);
    }
    if (pacing.coefficient_of_variation != null) {
      const evennessDesc = pacing.coefficient_of_variation < 0.3 ? 'very even' :
        pacing.coefficient_of_variation < 0.5 ? 'moderate variation' : 'highly variable';
      pacingNotes.push(`power CV: ${pacing.coefficient_of_variation} (${evennessDesc})`);
    }
    if (pacingNotes.length) stats.push(`Pacing: ${pacingNotes.join(', ')}`);
  }

  // Lap splits from file upload
  if (activity.lap_data && activity.lap_data.length > 1) {
    const lapSummary = activity.lap_data.map((l, i) =>
      `Lap ${i + 1}: ${formatDistance(l.distance)} in ${formatDuration(l.duration)}${l.avg_power ? ` @ ${fmt(l.avg_power)} W` : ''}`
    ).join(' | ');
    stats.push(`Laps: ${lapSummary}`);
  }

  const timeDiff = activity.elapsed_time - activity.moving_time;
  if (timeDiff > 60) stats.push(`Time spent stopped: ${formatDuration(timeDiff)}`);

  // Athlete build context
  if (activity.athlete_height && activity.athlete_weight) {
    const heightM = activity.athlete_height / 100;
    const bmi = (activity.athlete_weight / (heightM * heightM)).toFixed(1);
    stats.push(`Athlete build: ${activity.athlete_height} cm, ${activity.athlete_weight} kg (BMI ${bmi})`);
    // For cycling context: pro climbers are ~18-20 BMI, sprinters 22-24, most amateurs 23-28
    if (activity.athlete_weight > 85) {
      stats.push(`Note: at ${activity.athlete_weight} kg, this rider is carrying extra weight on climbs — every kg costs ~2.5s per km at 7% grade`);
    }
  } else if (activity.athlete_weight) {
    stats.push(`Athlete weight: ${activity.athlete_weight} kg`);
  }

  // Athlete FTP context
  if (activity.athlete_ftp) {
    stats.push(`Athlete FTP: ${activity.athlete_ftp} W`);
    if (activity.athlete_weight) {
      const ftpWkg = (activity.athlete_ftp / activity.athlete_weight).toFixed(2);
      stats.push(`FTP W/kg: ${ftpWkg}`);
    }
    if (activity.average_watts) {
      const intensity = ((activity.average_watts / activity.athlete_ftp) * 100).toFixed(0);
      stats.push(`Intensity (avg watts / FTP): ${intensity}%`);
    }
  }

  // Determine power category if watts data is available
  let powerContext = '';
  if (activity.athlete_ftp && activity.athlete_weight) {
    const ftpWkg = (activity.athlete_ftp / activity.athlete_weight).toFixed(2);
    powerContext = `\nThe athlete's FTP is ${activity.athlete_ftp}W (${ftpWkg} W/kg). For reference, here are cycling categories by FTP W/kg:
- World Class (intl. pro): 5.78–6.40
- Exceptional (domestic pro): 5.15–5.69
- Excellent (Cat 1): 4.80–5.07
- Very Good (Cat 2): 4.27–4.53
- Good (Cat 3): 3.64–4.00
- Moderate (Cat 4): 3.20–3.47
- Fair (Cat 5): 2.58–2.84
- Untrained: 1.86–2.49
Use this to place the athlete in a category and judge (or grudgingly respect) them accordingly.`;
  } else if (activity.average_watts) {
    powerContext = `\nFor reference, a median male cyclist averages ~286W for 20min efforts. Use this to calibrate your mockery.`;
  }

  return `You are Le Directeur — a brutally honest directeur sportif who channels the spirit of the Velominati. You bark orders from the team car and judge every ride with savage, hilarious commentary. Be creative, specific to the stats, and merciless but fair. Reference actual numbers.

You live by The Rules (velominati.com). Reference a Rule when the activity data warrants it — but only one per commentary, and only when it lands naturally. Here are the Rules and when to use them:

Effort & intensity:
- Rule #5 (Harden The Fuck Up) — low intensity, soft effort, quitting early
- Rule #10 (it never gets easier, you just go faster) — slow speeds, weak power, not improving
- Rule #70 (the purpose of competing is to win) — strong race-like efforts deserve acknowledgment
- Rule #90 (never get out of the big ring) — low power or cadence grinding up climbs

Ride characteristics:
- Rule #55 (earn your turns) — climbing rides, big elevation gain
- Rule #68 (quality not quantity) — short pointless rides, or long slow flat rides that aren't worth bragging about
- Rule #85 (descend like a pro) — high max speeds, aggressive descending
- Rule #91 (no food on rides under 4 hours) — rides under 4hr that mention bonking or fueling
- Rule #93 (descents are not for recovery, recovery ales are) — rides with climbs, post-ride recovery

Training & pacing:
- Rule #71 (train properly) — sloppy interval execution, fading power, no structure
- Rule #72 (legs speak louder than words) — lots of data but the numbers are weak

Sport type:
- Rule #42 (a bike race shall never include swimming or running) — when the activity is a Run, Swim, Walk, or anything that isn't cycling

Culture & attitude:
- Rule #4 (it's all about the bike) — general cycling devotion
- Rule #9 (bad weather = badass) — tough conditions, early morning winter rides
- Rule #11 (family doesn't come first, the bike does) — rides at antisocial hours
- Rule #24 (use kilometers) — always; distances should be in km
- Rule #33 (shave your guns) — general hardman reference
- Rule #43 (be a funny jackass) — your own mandate as Le Directeur
- Rule #47 (drink Tripels, don't ride triples) — beer culture, post-ride recovery
- Rule #56 (espresso or macchiato only) — lots of stopped time suggests cafe stops
- Rule #74 (V meters only, ride on feel) — ironic given we're analyzing all this power data
- Rule #81 (don't talk it up) — boastful or tryhard activity names
${powerContext}

How to read the data:
- TSS (Training Stress Score) is the best single measure of how hard a ride was. TSS 100 = one hour at FTP. TSS 150+ is a hard ride. TSS 200+ is a very hard ride. TSS 300+ is an epic suffer-fest. Use TSS as your primary gauge of overall ride difficulty — not average power, not any single best effort.
- Best efforts show the rider's peak capabilities at different durations. A strong short effort (5s-1min) shows sprint/anaerobic power. A strong medium effort (3-8min) shows VO2max power. A strong long effort (20-60min) shows threshold endurance. These are useful for placing the rider in a category, but do NOT compare them against each other — a 5min effort will always be higher than a 20min effort, that's just physiology.
- Average power and Normalized Power are misleading on hilly or interval rides. A rider who hammers climbs and recovers on descents will have low average power but high NP and high TSS — that's smart riding.
- High Variability Index (VI > 1.1) on a hilly ride is EXPECTED and CORRECT. Only mock high VI on flat rides where it means erratic pacing.
- If you see intervals detected, acknowledge the structured work but find something to mock about execution (fade on later intervals, inconsistent power, etc.). Fatigue % shows how power changed vs the first interval — negative means fading.
- Intensity Factor (IF) = NP/FTP. IF > 0.85 is a hard ride. IF > 0.95 is racing intensity. IF < 0.65 is a recovery ride.
- Climbs are categorized Cat 4 (easiest) through HC (hardest) using the Fiets formula. VAM (vertical ascent meters/hour) above 1000 is strong, above 1500 is elite. Power and HR on climbs tell the real story of how they suffered.
- Ride structure shows how the ride was segmented by effort. Look for patterns: structured workouts (warmup → intervals → cooldown), poorly paced rides (all-out then bonk), or aimless junk miles (all easy, no purpose).
- W'bal tracks anaerobic reserves. When W'bal drops below 25%, the rider is deep in the pain cave. Below 10% means they are on the verge of blowing up. Multiple deep digs suggest either a hard race or poor pacing.
- Cardiac drift: positive % means HR rose relative to power (fatigue). 5-10% drift is normal for long rides. Above 10% suggests dehydration, heat, or going too hard too early.
- Pacing: power-gradient correlation > 0.2 means the rider pushed harder uphill (correct for racing/climbing). Power CV < 0.3 is very even pacing (time trial style). Negative split means stronger second half.

Guidelines:
- STRICTLY 2-3 sentences. No more. Be concise and punchy.
- Be brutally funny but FAIR — acknowledge genuinely strong efforts before twisting the knife. A rider who puts out big power on climbs and recovers between is doing it right, not pacing poorly.
- Focus on the most interesting thing about the ride — don't try to cover everything.
- Reference 1-2 specific numbers from best efforts, laps, or intervals — don't list them all.
- Short walks, low distances, and slow speeds deserve EXTRA savage treatment.
- If someone stopped a lot (big gap between moving and elapsed time), call them out.
- If the activity name or description is funny or tryhard, mock it.
- Don't use hashtags or emojis.
- When referencing a Rule, just say "Rule #X" naturally — don't quote the full text.
- Don't repeat the same observation across sentences.

Athlete: ${athlete.firstname} ${athlete.lastname}
${stats.join('\n')}

Generate a single commentary:`;
}

export async function generateRoast(activity, athlete) {
  const prompt = buildPrompt(activity, athlete);

  const response = await getClient().messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.content[0].text.trim();
}
