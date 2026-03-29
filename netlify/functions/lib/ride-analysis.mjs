// Comprehensive ride analysis module.
// Consumes canonical streams (from Strava API or FIT/GPX parsing) and produces
// a rich analysis object: climbs, segments, intervals, W'bal, HR, pacing.

import { mean, standardDeviation, sampleCorrelation, linearRegression, zScore, quantile } from 'simple-statistics';
import savitzkyGolayModule from 'ml-savitzky-golay';
const savitzkyGolay = savitzkyGolayModule.default || savitzkyGolayModule;
import {
  analyzePower,
  computeNormalizedPower,
} from './power-analysis.mjs';

// ── Main entry point ────────────────────────────────────────────────────────

export function analyzeRide(streams, options = {}) {
  if (!streams?.time?.length) return null;

  const { ftp, weight, wprime, hrZones } = options;

  const result = {};

  // Power analysis (delegates to existing module)
  if (streams.watts) {
    const avgPower = mean(streams.watts.filter(w => w > 0)) || null;
    result.power = analyzePower(streams.watts, ftp, avgPower);
    // Enhanced interval detection
    const advanced = detectIntervalsAdvanced(streams, { ftp });
    if (advanced) result.power.intervals = advanced;
  }

  // Climb detection
  result.climbs = detectClimbs(streams);

  // Ride segmentation
  result.segments = detectSegments(streams, { ftp });

  // W'bal tracking
  result.wprime = streams.watts ? computeWPrimeBal(streams, { ftp, wprime }) : null;

  // Heart rate analysis
  result.hr_analysis = streams.heartrate ? analyzeHeartRate(streams, { ftp, hrZones }) : null;

  // Pacing analysis
  result.pacing = streams.watts ? analyzePacing(streams, { ftp }) : null;

  return result;
}


// ── Smoothing helpers ───────────────────────────────────────────────────────

function smooth(data, windowSize = 15) {
  // Try Savitzky-Golay first (preserves peaks better), fall back to rolling avg
  try {
    if (data.length >= windowSize && windowSize >= 5) {
      const w = windowSize % 2 === 0 ? windowSize + 1 : windowSize;
      return savitzkyGolay(data, 1, { windowSize: w, derivative: 0, polynomial: 3 });
    }
  } catch {
    // fall through to rolling average
  }
  return rollingAverage(data, windowSize);
}

function rollingAverage(data, window) {
  const result = new Array(data.length);
  const half = Math.floor(window / 2);
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i] || 0;
    if (i >= window) sum -= data[i - window] || 0;
    const start = Math.max(0, i - half);
    const end = Math.min(data.length - 1, i + half);
    const count = end - start + 1;
    // Recompute for edges
    if (i < half || i >= data.length - half) {
      let s = 0;
      for (let j = start; j <= end; j++) s += data[j] || 0;
      result[i] = s / count;
    } else {
      result[i] = sum / Math.min(window, i + 1);
    }
  }
  return result;
}

function sliceAvg(arr, start, end) {
  if (!arr) return null;
  let sum = 0, count = 0;
  for (let i = start; i < end; i++) {
    if (arr[i] > 0) { sum += arr[i]; count++; }
  }
  return count > 0 ? sum / count : 0;
}


// ── Climb Detection ─────────────────────────────────────────────────────────

function detectClimbs(streams) {
  if (!streams.altitude || !streams.distance) return null;
  if (streams.altitude.length < 60) return null;

  // Smooth altitude to remove GPS noise
  const smoothedAlt = smooth(streams.altitude, 31);
  const dist = streams.distance;

  // Compute smoothed gradient
  const grade = [];
  for (let i = 0; i < smoothedAlt.length; i++) {
    if (i === 0) { grade.push(0); continue; }
    const dAlt = smoothedAlt[i] - smoothedAlt[i - 1];
    const dDist = dist[i] - dist[i - 1];
    grade.push(dDist > 0.5 ? (dAlt / dDist) * 100 : grade[i - 1] || 0);
  }

  const smoothedGrade = smooth(grade, 31);

  const MIN_GRADE = 2;       // % to start a climb
  const END_GRADE = 1;       // % to end a climb
  const MIN_DISTANCE = 200;  // meters minimum climb length
  const MIN_ELEV = 20;       // meters minimum elevation gain
  const FLAT_TOLERANCE = 300; // meters of flat allowed within a climb

  const climbs = [];
  let inClimb = false;
  let climbStart = 0;
  let flatStart = -1;

  for (let i = 0; i < smoothedGrade.length; i++) {
    if (!inClimb && smoothedGrade[i] >= MIN_GRADE) {
      inClimb = true;
      climbStart = i;
      flatStart = -1;
    } else if (inClimb && smoothedGrade[i] < END_GRADE) {
      if (flatStart < 0) flatStart = i;
      const flatDist = dist[i] - dist[flatStart];
      if (flatDist > FLAT_TOLERANCE) {
        // End the climb at flatStart
        finalizeClimb(climbs, streams, smoothedAlt, climbStart, flatStart);
        inClimb = false;
        flatStart = -1;
      }
    } else if (inClimb && smoothedGrade[i] >= END_GRADE) {
      flatStart = -1;
    }
  }

  // Close any open climb
  if (inClimb) {
    finalizeClimb(climbs, streams, smoothedAlt, climbStart, smoothedAlt.length - 1);
  }

  // Filter out climbs that are too short or too flat
  return climbs.filter(c => c.distance >= MIN_DISTANCE && c.elevation_gain >= MIN_ELEV).length > 0
    ? climbs.filter(c => c.distance >= MIN_DISTANCE && c.elevation_gain >= MIN_ELEV)
    : null;
}

function finalizeClimb(climbs, streams, smoothedAlt, startIdx, endIdx) {
  const dist = streams.distance;
  const climbDist = dist[endIdx] - dist[startIdx];
  if (climbDist < 50) return;

  const elevGain = smoothedAlt[endIdx] - smoothedAlt[startIdx];
  if (elevGain <= 0) return;

  const avgGrade = (elevGain / climbDist) * 100;

  // Max gradient over 100m windows
  let maxGrade = 0;
  for (let i = startIdx; i < endIdx; i++) {
    const windowEnd = streams.distance.findIndex((d, j) => j > i && d - dist[i] >= 100);
    if (windowEnd > 0 && windowEnd <= endIdx) {
      const g = ((smoothedAlt[windowEnd] - smoothedAlt[i]) / (dist[windowEnd] - dist[i])) * 100;
      if (g > maxGrade) maxGrade = g;
    }
  }

  const durationSec = streams.time[endIdx] - streams.time[startIdx];
  const vam = durationSec > 0 ? (elevGain / durationSec) * 3600 : 0;

  // Fiets difficulty score
  const difficulty = (elevGain * elevGain) / (climbDist * 10);
  let category, categoryLabel;
  if (difficulty >= 1500) { category = 0; categoryLabel = 'HC'; }
  else if (difficulty >= 800) { category = 1; categoryLabel = 'Cat 1'; }
  else if (difficulty >= 400) { category = 2; categoryLabel = 'Cat 2'; }
  else if (difficulty >= 150) { category = 3; categoryLabel = 'Cat 3'; }
  else if (difficulty >= 50) { category = 4; categoryLabel = 'Cat 4'; }
  else return; // Too easy to categorize

  climbs.push({
    start_index: startIdx,
    end_index: endIdx,
    start_distance: Math.round(dist[startIdx]),
    end_distance: Math.round(dist[endIdx]),
    distance: Math.round(climbDist),
    elevation_gain: Math.round(elevGain),
    avg_gradient: parseFloat(avgGrade.toFixed(1)),
    max_gradient: parseFloat(maxGrade.toFixed(1)),
    avg_power: streams.watts ? Math.round(sliceAvg(streams.watts, startIdx, endIdx)) : null,
    normalized_power: streams.watts ? computeNormalizedPower(streams.watts.slice(startIdx, endIdx)) : null,
    avg_speed: streams.velocity_smooth ? parseFloat(sliceAvg(streams.velocity_smooth, startIdx, endIdx).toFixed(1)) : null,
    avg_hr: streams.heartrate ? Math.round(sliceAvg(streams.heartrate, startIdx, endIdx)) : null,
    vam: Math.round(vam),
    duration: durationSec,
    category,
    category_label: categoryLabel,
    start_latlng: streams.latlng?.[startIdx] || null,
    end_latlng: streams.latlng?.[endIdx] || null,
  });
}


// ── Ride Segmentation (CUSUM change point detection) ────────────────────────

function detectSegments(streams, options = {}) {
  const { ftp } = options;

  // Build effort signal from best available data
  let signal;
  let reference;
  if (streams.watts) {
    const validWatts = streams.watts.filter(w => w > 0);
    reference = ftp || (validWatts.length > 0 ? mean(validWatts) : null);
    if (!reference) return null;
    signal = streams.watts.map(w => w / reference);
  } else if (streams.heartrate) {
    const validHR = streams.heartrate.filter(h => h > 0);
    reference = validHR.length > 0 ? mean(validHR) : null;
    if (!reference) return null;
    signal = streams.heartrate.map(h => h / reference);
  } else if (streams.velocity_smooth) {
    const validSpeed = streams.velocity_smooth.filter(v => v > 0);
    reference = validSpeed.length > 0 ? mean(validSpeed) : null;
    if (!reference) return null;
    signal = streams.velocity_smooth.map(v => v / reference);
  } else {
    return null;
  }

  // Smooth the signal
  const smoothed = smooth(signal, 31);
  const sd = standardDeviation(smoothed);
  if (sd < 0.01) return null; // Basically constant effort

  // CUSUM parameters — tuned to avoid over-segmenting
  const drift = 0.5 * sd;
  const threshold = 1.5 * sd;
  const signalMean = mean(smoothed);

  // Run CUSUM — detect both upward and downward shifts
  const changePoints = [0];
  let sUp = 0, sDown = 0;

  for (let i = 1; i < smoothed.length; i++) {
    const diff = smoothed[i] - signalMean;
    sUp = Math.max(0, sUp + diff - drift);
    sDown = Math.max(0, sDown - diff - drift);

    if (sUp > threshold || sDown > threshold) {
      // Only add if far enough from last change point (120s minimum)
      if (streams.time[i] - streams.time[changePoints[changePoints.length - 1]] >= 120) {
        changePoints.push(i);
      }
      sUp = 0;
      sDown = 0;
    }
  }
  changePoints.push(smoothed.length - 1);

  // Build segments from change points
  const segments = [];
  for (let i = 0; i < changePoints.length - 1; i++) {
    const start = changePoints[i];
    const end = changePoints[i + 1];
    const duration = streams.time[end] - streams.time[start];
    if (duration < 10) continue;

    const avgPower = streams.watts ? Math.round(sliceAvg(streams.watts, start, end)) : null;
    const avgHR = streams.heartrate ? Math.round(sliceAvg(streams.heartrate, start, end)) : null;
    const avgSpeed = streams.velocity_smooth ? parseFloat(sliceAvg(streams.velocity_smooth, start, end).toFixed(1)) : null;
    const avgCadence = streams.cadence ? Math.round(sliceAvg(streams.cadence, start, end)) : null;

    // Classify segment by effort level
    const segMean = mean(smoothed.slice(start, end));
    const type = classifyEffort(segMean, ftp != null);

    segments.push({
      start_index: start,
      end_index: end,
      start_time: streams.time[start],
      duration,
      type,
      avg_power: avgPower,
      avg_hr: avgHR,
      avg_speed: avgSpeed,
      avg_cadence: avgCadence,
    });
  }

  // Tag first/last segments as warmup/cooldown if appropriate
  if (segments.length >= 3) {
    const first = segments[0];
    if ((first.type === 'easy' || first.type === 'recovery') && first.duration < 900) {
      first.type = 'warmup';
    }
    const last = segments[segments.length - 1];
    if ((last.type === 'easy' || last.type === 'recovery') && last.duration < 900) {
      last.type = 'cooldown';
    }
  }

  // Merge adjacent segments of the same type
  const merged = [segments[0]];
  for (let i = 1; i < segments.length; i++) {
    const prev = merged[merged.length - 1];
    if (segments[i].type === prev.type) {
      // Absorb into previous
      prev.end_index = segments[i].end_index;
      prev.duration += segments[i].duration;
      prev.avg_power = streams.watts
        ? Math.round(sliceAvg(streams.watts, prev.start_index, prev.end_index))
        : null;
      prev.avg_hr = streams.heartrate
        ? Math.round(sliceAvg(streams.heartrate, prev.start_index, prev.end_index))
        : null;
    } else {
      merged.push(segments[i]);
    }
  }

  return merged.length >= 2 ? merged : null;
}

function classifyEffort(normalizedValue, hasFTP) {
  // normalizedValue is effort / reference (FTP or ride avg)
  // With FTP: direct zone mapping. Without: relative to ride average.
  if (hasFTP) {
    if (normalizedValue < 0.55) return 'recovery';
    if (normalizedValue < 0.75) return 'easy';
    if (normalizedValue < 0.90) return 'tempo';
    if (normalizedValue < 1.05) return 'threshold';
    if (normalizedValue < 1.20) return 'vo2max';
    return 'sprint';
  }
  // Without FTP, values are relative to ride average
  if (normalizedValue < 0.6) return 'recovery';
  if (normalizedValue < 0.85) return 'easy';
  if (normalizedValue < 1.0) return 'tempo';
  if (normalizedValue < 1.15) return 'threshold';
  if (normalizedValue < 1.35) return 'vo2max';
  return 'sprint';
}


// ── Advanced Interval Detection ─────────────────────────────────────────────

function detectIntervalsAdvanced(streams, options = {}) {
  if (!streams.watts) return null;

  const watts = streams.watts;
  const time = streams.time;
  const validWatts = watts.filter(w => w > 0);
  if (validWatts.length < 60) return null;

  const avg = mean(validWatts);
  const sd = standardDeviation(validWatts);
  if (sd < 10) return null; // Very constant power, no intervals

  // Smooth power for detection (30s window)
  const smoothedPower = smooth(watts, 31);

  // Z-score threshold for interval detection
  const Z_THRESHOLD = 0.8;
  const MIN_DURATION = 10; // seconds minimum
  const MIN_GAP = 15;      // seconds between intervals

  const intervals = [];
  let inInterval = false;
  let intervalStart = 0;
  let belowCount = 0;

  for (let i = 0; i < smoothedPower.length; i++) {
    const z = (smoothedPower[i] - avg) / sd;

    if (z >= Z_THRESHOLD) {
      if (!inInterval) {
        inInterval = true;
        intervalStart = i;
      }
      belowCount = 0;
    } else if (inInterval) {
      belowCount++;
      if (belowCount >= MIN_GAP) {
        const endIdx = i - belowCount;
        const duration = time[endIdx] - time[intervalStart];
        if (duration >= MIN_DURATION) {
          addInterval(intervals, streams, intervalStart, endIdx, avg, sd, options.ftp);
        }
        inInterval = false;
      }
    }
  }

  // Close open interval
  if (inInterval) {
    const duration = time[smoothedPower.length - 1] - time[intervalStart];
    if (duration >= MIN_DURATION) {
      addInterval(intervals, streams, intervalStart, smoothedPower.length - 1, avg, sd, options.ftp);
    }
  }

  if (intervals.length < 1) return null;

  // Compute fatigue index for repeated similar efforts
  if (intervals.length >= 2) {
    const firstPower = intervals[0].avg_power;
    const lastPower = intervals[intervals.length - 1].avg_power;
    for (const interval of intervals) {
      interval.fatigue_pct = parseFloat(((interval.avg_power / firstPower - 1) * 100).toFixed(1));
    }
  }

  return intervals;
}

function addInterval(intervals, streams, startIdx, endIdx, rideMean, rideSD, ftp) {
  const watts = streams.watts;
  const time = streams.time;
  const duration = time[endIdx] - time[startIdx];
  const avgPower = Math.round(sliceAvg(watts, startIdx, endIdx));
  const maxPower = Math.max(...watts.slice(startIdx, endIdx));
  const np = computeNormalizedPower(watts.slice(startIdx, endIdx));

  // Classify interval type
  let type;
  if (duration < 30 && avgPower > rideMean * 1.5) type = 'sprint';
  else if (duration <= 480 && avgPower > rideMean * 1.2) type = 'vo2max';
  else if (duration > 180) type = 'threshold';
  else type = 'hard';

  intervals.push({
    start: startIdx,
    start_time: time[startIdx],
    duration,
    avg_power: avgPower,
    max_power: maxPower,
    normalized_power: np,
    pct_ftp: ftp ? Math.round((avgPower / ftp) * 100) : null,
    pct_avg: Math.round((avgPower / rideMean) * 100),
    avg_hr: streams.heartrate ? Math.round(sliceAvg(streams.heartrate, startIdx, endIdx)) : null,
    avg_cadence: streams.cadence ? Math.round(sliceAvg(streams.cadence, startIdx, endIdx)) : null,
    type,
  });
}


// ── W'bal (W-prime Balance) ─────────────────────────────────────────────────

function computeWPrimeBal(streams, options = {}) {
  if (!streams.watts) return null;

  const cp = options.ftp;
  if (!cp) return null;

  const wPrime = options.wprime || 15000; // Default 15kJ
  const watts = streams.watts;
  const time = streams.time;

  // Differential W'bal model (Skiba et al.)
  let balance = wPrime;
  let minBalance = wPrime;
  let minBalanceTime = 0;
  let depletionCount = 0;
  let nearEmptySeconds = 0;
  let wasLow = false;

  for (let i = 1; i < watts.length; i++) {
    const dt = time[i] - time[i - 1];
    if (dt <= 0 || dt > 10) continue; // skip gaps

    const power = watts[i];
    if (power > cp) {
      // Depletion
      balance -= (power - cp) * dt;
    } else {
      // Recovery: exponential reconstitution
      balance += (wPrime - balance) * (1 - Math.exp(-(cp - power) * dt / wPrime));
    }

    balance = Math.max(0, Math.min(wPrime, balance));

    if (balance < minBalance) {
      minBalance = balance;
      minBalanceTime = time[i];
    }

    const pct = balance / wPrime;
    if (pct < 0.10) nearEmptySeconds += dt;
    if (pct < 0.25 && !wasLow) {
      depletionCount++;
      wasLow = true;
    } else if (pct >= 0.25) {
      wasLow = false;
    }
  }

  // Only report if there was meaningful depletion
  if (minBalance > wPrime * 0.8) return null;

  return {
    w_prime: wPrime,
    ftp_used: cp,
    min_balance: Math.round(minBalance),
    min_balance_pct: Math.round((minBalance / wPrime) * 100),
    min_balance_time: minBalanceTime,
    depletion_count: depletionCount,
    near_empty_seconds: nearEmptySeconds,
  };
}


// ── Heart Rate Analysis ─────────────────────────────────────────────────────

function analyzeHeartRate(streams, options = {}) {
  if (!streams.heartrate) return null;

  const hr = streams.heartrate;
  const time = streams.time;
  const validHR = hr.filter(h => h > 0);
  if (validHR.length < 60) return null;

  const maxHR = Math.max(...validHR);
  const avgHR = Math.round(mean(validHR));

  // Determine zone boundaries
  let zones;
  if (options.hrZones) {
    zones = options.hrZones;
  } else {
    // Estimate zones from max HR observed
    const maxRef = maxHR;
    zones = [
      { zone: 1, label: 'Recovery', min: 0, max: Math.round(maxRef * 0.60) },
      { zone: 2, label: 'Endurance', min: Math.round(maxRef * 0.60), max: Math.round(maxRef * 0.70) },
      { zone: 3, label: 'Tempo', min: Math.round(maxRef * 0.70), max: Math.round(maxRef * 0.80) },
      { zone: 4, label: 'Threshold', min: Math.round(maxRef * 0.80), max: Math.round(maxRef * 0.90) },
      { zone: 5, label: 'VO2max', min: Math.round(maxRef * 0.90), max: maxRef + 50 },
    ];
  }

  // Time in zone
  const zoneSeconds = new Array(zones.length).fill(0);
  let totalSeconds = 0;

  for (let i = 1; i < hr.length; i++) {
    const dt = time[i] - time[i - 1];
    if (dt <= 0 || dt > 10 || hr[i] <= 0) continue;
    totalSeconds += dt;

    for (let z = zones.length - 1; z >= 0; z--) {
      if (hr[i] >= zones[z].min) {
        zoneSeconds[z] += dt;
        break;
      }
    }
  }

  const zoneDistribution = zones.map((z, i) => ({
    ...z,
    seconds: zoneSeconds[i],
    pct: totalSeconds > 0 ? Math.round((zoneSeconds[i] / totalSeconds) * 100) : 0,
  }));

  // Cardiac drift: compare power/HR efficiency first half vs second half
  let drift = null;
  if (streams.watts) {
    const midIdx = Math.floor(hr.length / 2);
    const firstHalfHR = sliceAvg(hr, 0, midIdx);
    const secondHalfHR = sliceAvg(hr, midIdx, hr.length);
    const firstHalfPower = sliceAvg(streams.watts, 0, midIdx);
    const secondHalfPower = sliceAvg(streams.watts, midIdx, hr.length);

    if (firstHalfHR > 0 && secondHalfHR > 0 && firstHalfPower > 0 && secondHalfPower > 0) {
      const firstEff = firstHalfPower / firstHalfHR;
      const secondEff = secondHalfPower / secondHalfHR;
      drift = {
        first_half_efficiency: parseFloat(firstEff.toFixed(2)),
        second_half_efficiency: parseFloat(secondEff.toFixed(2)),
        drift_pct: parseFloat(((firstEff - secondEff) / firstEff * 100).toFixed(1)),
      };
    }
  }

  return {
    zones: zoneDistribution,
    drift,
    max_hr: maxHR,
    avg_hr: avgHR,
  };
}


// ── Pacing Analysis ─────────────────────────────────────────────────────────

function analyzePacing(streams, options = {}) {
  if (!streams.watts) return null;

  const watts = streams.watts;
  const time = streams.time;
  const validWatts = watts.filter(w => w > 0);
  if (validWatts.length < 120) return null;

  const avgPower = mean(validWatts);
  const sdPower = standardDeviation(validWatts);

  // Coefficient of variation
  const cv = avgPower > 0 ? parseFloat((sdPower / avgPower).toFixed(2)) : null;

  // First half vs second half NP
  const midIdx = Math.floor(watts.length / 2);
  const firstHalfNP = computeNormalizedPower(watts.slice(0, midIdx));
  const secondHalfNP = computeNormalizedPower(watts.slice(midIdx));
  const negativeSplit = secondHalfNP > firstHalfNP;
  const fadePct = firstHalfNP > 0
    ? parseFloat(((firstHalfNP - secondHalfNP) / firstHalfNP * 100).toFixed(1))
    : null;

  // Power-gradient correlation
  let powerGradientCorr = null;
  if (streams.grade_smooth) {
    // Filter to moving points with valid data
    const pairs = [];
    for (let i = 0; i < watts.length; i++) {
      if (watts[i] > 0 && streams.grade_smooth[i] != null && streams.velocity_smooth?.[i] > 0.5) {
        pairs.push([streams.grade_smooth[i], watts[i]]);
      }
    }
    if (pairs.length > 60) {
      try {
        const grades = pairs.map(p => p[0]);
        const powers = pairs.map(p => p[1]);
        powerGradientCorr = parseFloat(sampleCorrelation(grades, powers).toFixed(2));
      } catch {
        // correlation can fail with constant data
      }
    }
  }

  // Power fade: linear regression of rolling 5-min NP
  let powerFadeSlope = null;
  const windowSize = 300; // 5 min
  if (watts.length > windowSize * 2) {
    const npPoints = [];
    for (let i = 0; i <= watts.length - windowSize; i += 60) {
      const np = computeNormalizedPower(watts.slice(i, i + windowSize));
      if (np) npPoints.push([time[i], np]);
    }
    if (npPoints.length >= 3) {
      try {
        const reg = linearRegression(npPoints);
        // Slope is watts per second; convert to watts per hour
        powerFadeSlope = parseFloat((reg.m * 3600).toFixed(1));
      } catch {
        // regression can fail
      }
    }
  }

  return {
    coefficient_of_variation: cv,
    first_half_np: firstHalfNP,
    second_half_np: secondHalfNP,
    negative_split: negativeSplit,
    fade_pct: fadePct,
    power_gradient_correlation: powerGradientCorr,
    power_fade_per_hour: powerFadeSlope,
  };
}
