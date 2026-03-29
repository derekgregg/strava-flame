import FitParser from 'fit-file-parser';
import { XMLParser } from 'fast-xml-parser';
import { analyzePower } from './power-analysis.mjs';
import { encode as encodePolyline, simplify } from './polyline.mjs';

// Parse an activity file (FIT, GPX, or TCX) and return a normalized activity object.
export async function parseActivityFile(buffer, filename) {
  const ext = filename.split('.').pop().toLowerCase();

  switch (ext) {
    case 'fit':
      return parseFIT(buffer);
    case 'gpx':
      return parseGPX(buffer);
    case 'tcx':
      return parseTCX(buffer);
    default:
      throw new Error(`Unsupported file format: .${ext}`);
  }
}

// Extract canonical streams object from FIT per-second records.
// Matches the same format as normalizeStreams() in strava.mjs.
function extractStreamsFromRecords(records) {
  if (!records?.length) return null;

  const startTime = records[0].timestamp;
  const hasPower = records.some(r => r.power != null);
  const hasHR = records.some(r => r.heart_rate != null);
  const hasCadence = records.some(r => r.cadence != null);
  const hasAltitude = records.some(r => (r.enhanced_altitude ?? r.altitude) != null);
  const hasDistance = records.some(r => r.distance != null);
  const hasSpeed = records.some(r => (r.enhanced_speed ?? r.speed) != null);
  const hasGPS = records.some(r => r.position_lat != null && r.position_long != null);
  const hasTemp = records.some(r => r.temperature != null);

  const streams = {
    time: [],
    watts: hasPower ? [] : null,
    heartrate: hasHR ? [] : null,
    cadence: hasCadence ? [] : null,
    altitude: hasAltitude ? [] : null,
    distance: hasDistance ? [] : null,
    velocity_smooth: hasSpeed ? [] : null,
    grade_smooth: null, // computed below if possible
    latlng: hasGPS ? [] : null,
    temp: hasTemp ? [] : null,
    moving: null,
  };

  for (const r of records) {
    const t = r.timestamp instanceof Date
      ? Math.round((r.timestamp - startTime) / 1000)
      : Math.round((r.timestamp - startTime));
    streams.time.push(t);

    if (hasPower) streams.watts.push(r.power || 0);
    if (hasHR) streams.heartrate.push(r.heart_rate || 0);
    if (hasCadence) streams.cadence.push(r.cadence || 0);
    if (hasAltitude) streams.altitude.push(r.enhanced_altitude ?? r.altitude ?? 0);
    if (hasDistance) streams.distance.push(r.distance || 0);
    if (hasSpeed) streams.velocity_smooth.push(r.enhanced_speed ?? r.speed ?? 0);
    if (hasGPS) {
      streams.latlng.push(
        r.position_lat != null && r.position_long != null
          ? [r.position_lat, r.position_long]
          : null
      );
    }
    if (hasTemp) streams.temp.push(r.temperature ?? 0);
  }

  // Compute grade_smooth from altitude + distance if both exist
  if (hasAltitude && hasDistance) {
    streams.grade_smooth = [];
    for (let i = 0; i < streams.altitude.length; i++) {
      if (i === 0) {
        streams.grade_smooth.push(0);
      } else {
        const dAlt = streams.altitude[i] - streams.altitude[i - 1];
        const dDist = streams.distance[i] - streams.distance[i - 1];
        streams.grade_smooth.push(dDist > 0.5 ? (dAlt / dDist) * 100 : streams.grade_smooth[i - 1] || 0);
      }
    }
  }

  return streams;
}

// Extract canonical streams from GPX trackpoints.
function extractStreamsFromGPX(points) {
  if (!points?.length || points.length < 2) return null;

  const firstTime = points[0].time ? new Date(points[0].time) : null;
  if (!firstTime) return null;

  const hasEle = points.some(pt => pt.ele != null);
  const hasHR = points.some(pt => {
    const ext = pt.extensions;
    const tpx = ext?.TrackPointExtension || ext;
    return tpx && (parseInt(tpx.hr) || parseInt(tpx.heartrate)) > 0;
  });
  const hasPower = points.some(pt => {
    const ext = pt.extensions;
    const tpx = ext?.TrackPointExtension || ext;
    return tpx && (parseInt(tpx.power) || parseInt(ext?.power)) > 0;
  });
  const hasCadence = points.some(pt => {
    const ext = pt.extensions;
    const tpx = ext?.TrackPointExtension || ext;
    return tpx && (parseInt(tpx.cad) || parseInt(tpx.cadence)) > 0;
  });

  const streams = {
    time: [],
    watts: hasPower ? [] : null,
    heartrate: hasHR ? [] : null,
    cadence: hasCadence ? [] : null,
    altitude: hasEle ? [] : null,
    distance: [],
    velocity_smooth: [],
    grade_smooth: null,
    latlng: [],
    temp: null,
    moving: null,
  };

  let cumDist = 0;
  for (let i = 0; i < points.length; i++) {
    const pt = points[i];
    const ptTime = pt.time ? new Date(pt.time) : null;
    if (!ptTime) continue;

    const timeSec = Math.round((ptTime - firstTime) / 1000);
    streams.time.push(timeSec);

    const lat = parseFloat(pt['@_lat']), lon = parseFloat(pt['@_lon']);
    streams.latlng.push(!isNaN(lat) && !isNaN(lon) ? [lat, lon] : null);

    if (i > 0) {
      const prev = points[i - 1];
      const lat1 = parseFloat(prev['@_lat']), lon1 = parseFloat(prev['@_lon']);
      const dist = haversine(lat1, lon1, lat, lon);
      cumDist += dist;
      const prevTime = new Date(prev.time);
      const dt = (ptTime - prevTime) / 1000;
      streams.velocity_smooth.push(dt > 0 ? dist / dt : 0);
    } else {
      streams.velocity_smooth.push(0);
    }
    streams.distance.push(cumDist);

    if (hasEle) streams.altitude.push(parseFloat(pt.ele) || 0);

    const ext = pt.extensions;
    const tpx = ext?.TrackPointExtension || ext;
    if (hasHR) streams.heartrate.push(parseInt(tpx?.hr) || parseInt(tpx?.heartrate) || 0);
    if (hasCadence) streams.cadence.push(parseInt(tpx?.cad) || parseInt(tpx?.cadence) || 0);
    if (hasPower) streams.watts.push(parseInt(tpx?.power) || parseInt(ext?.power) || 0);
  }

  // Compute grade_smooth from altitude + distance
  if (hasEle && streams.distance.length > 0) {
    streams.grade_smooth = [];
    for (let i = 0; i < streams.altitude.length; i++) {
      if (i === 0) {
        streams.grade_smooth.push(0);
      } else {
        const dAlt = streams.altitude[i] - streams.altitude[i - 1];
        const dDist = streams.distance[i] - streams.distance[i - 1];
        streams.grade_smooth.push(dDist > 0.5 ? (dAlt / dDist) * 100 : streams.grade_smooth[i - 1] || 0);
      }
    }
  }

  return streams;
}

// --- FIT ---

function parseFIT(buffer) {
  return new Promise((resolve, reject) => {
    const parser = new FitParser({
      force: true,
      speedUnit: 'm/s',
      lengthUnit: 'm',
      temperatureUnit: 'celsius',
      elapsedRecordField: true,
      mode: 'list',
    });

    parser.parse(buffer, (err, data) => {
      if (err) return reject(new Error(`FIT parse error: ${err.message || err}`));
      if (!data) return reject(new Error('FIT file produced no data'));

      const sessions = data.sessions || [];
      const records = data.records || [];
      const laps = data.laps || [];

      if (!sessions.length && !records.length) {
        return reject(new Error('FIT file contains no activity data'));
      }

      const session = sessions[0] || {};
      const sportMap = {
        cycling: 'Ride', running: 'Run', walking: 'Walk',
        hiking: 'Hike', swimming: 'Swim', weight_training: 'WeightTraining',
        generic: 'Workout',
      };

      // Compute fallback stats from records when session summary is incomplete
      const distance = session.total_distance || 0;
      const movingTime = Math.round(session.total_timer_time || 0);
      const fallbackSpeed = distance > 0 && movingTime > 0 ? distance / movingTime : 0;

      // Compute elevation from records if session doesn't have it
      let elevGain = session.total_ascent || 0;
      if (!elevGain && records.length > 1) {
        let prevAlt = null;
        for (const r of records) {
          const alt = r.enhanced_altitude ?? r.altitude;
          if (alt != null && prevAlt != null && alt > prevAlt) elevGain += alt - prevAlt;
          if (alt != null) prevAlt = alt;
        }
        elevGain = Math.round(elevGain);
      }

      // Compute avg watts from records if session doesn't have it
      let avgWatts = session.avg_power || null;
      let maxWatts = session.max_power || null;
      if (!avgWatts && records.length > 0 && records.some(r => r.power != null)) {
        const powers = records.map(r => r.power || 0).filter(p => p > 0);
        if (powers.length) {
          avgWatts = Math.round(powers.reduce((a, b) => a + b, 0) / powers.length);
          maxWatts = Math.max(...powers);
        }
      }

      // Compute avg HR from records if session doesn't have it
      let avgHr = session.avg_heart_rate || null;
      let maxHr = session.max_heart_rate || null;
      if (!avgHr && records.length > 0 && records.some(r => r.heart_rate != null)) {
        const hrs = records.map(r => r.heart_rate || 0).filter(h => h > 0);
        if (hrs.length) {
          avgHr = Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length);
          maxHr = Math.max(...hrs);
        }
      }

      const activity = {
        name: null,
        sport_type: sportMap[session.sport] || session.sport || 'Workout',
        start_date: session.start_time || session.timestamp || (records[0]?.timestamp) || null,
        distance,
        moving_time: movingTime,
        elapsed_time: Math.round(session.total_elapsed_time || movingTime || 0),
        total_elevation_gain: elevGain,
        average_speed: session.enhanced_avg_speed || session.avg_speed || fallbackSpeed,
        max_speed: session.enhanced_max_speed || session.max_speed || 0,
        average_watts: avgWatts,
        max_watts: maxWatts,
        average_heartrate: avgHr,
        max_heartrate: maxHr,
        suffer_score: null,
        external_id: null,
        // Enrichment
        normalized_power: session.normalized_power || null,
        avg_cadence: session.avg_cadence || null,
        max_cadence: session.max_cadence || null,
        calories: session.total_calories || null,
        lap_data: laps.length > 0 ? laps.map(normalizeLap) : null,
      };

      // Full power analysis from per-second records
      if (records.length > 0 && records.some(r => r.power != null)) {
        const powerData = records.map(r => r.power || 0);
        const analysis = analyzePower(powerData, null, activity.average_watts);
        activity.power_curve = analysis.best_efforts;
        if (analysis.normalized_power) activity.normalized_power = analysis.normalized_power;
        if (analysis.variability_index) activity.variability_index = analysis.variability_index;
        activity.power_analysis = analysis;
      }

      // Extract per-second streams for ride analysis
      if (records.length > 0) {
        activity.streams = extractStreamsFromRecords(records);
      }

      // Extract GPS track and encode as polyline
      if (records.length > 0 && records.some(r => r.position_lat != null)) {
        const coords = records
          .filter(r => r.position_lat != null && r.position_long != null)
          .map(r => [r.position_lat, r.position_long]);
        if (coords.length > 1) {
          const simplified = simplify(coords, 0.00003);
          activity.route_polyline = encodePolyline(simplified);
        }
      }

      // Convert start_date to ISO string
      if (activity.start_date instanceof Date) {
        activity.start_date = activity.start_date.toISOString();
      } else if (typeof activity.start_date === 'string' && !activity.start_date.includes('T')) {
        activity.start_date = new Date(activity.start_date).toISOString();
      }

      resolve(activity);
    });
  });
}

function normalizeLap(lap) {
  return {
    distance: lap.total_distance || 0,
    duration: Math.round(lap.total_timer_time || 0),
    avg_speed: lap.enhanced_avg_speed || lap.avg_speed || 0,
    avg_power: lap.avg_power || null,
    avg_hr: lap.avg_heart_rate || null,
    avg_cadence: lap.avg_cadence || null,
    elevation_gain: lap.total_ascent || 0,
  };
}


// --- GPX ---

function parseGPX(buffer) {
  const xml = Buffer.from(buffer).toString('utf-8');
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
  });
  const doc = parser.parse(xml);
  const gpx = doc.gpx;
  if (!gpx) throw new Error('Invalid GPX file: no <gpx> element');

  const trk = gpx.trk;
  if (!trk) throw new Error('GPX file contains no tracks');

  const track = Array.isArray(trk) ? trk[0] : trk;
  let segments = track.trkseg;
  if (!segments) throw new Error('GPX track has no segments');
  if (!Array.isArray(segments)) segments = [segments];

  // Collect all trackpoints
  const points = [];
  for (const seg of segments) {
    let pts = seg.trkpt;
    if (!pts) continue;
    if (!Array.isArray(pts)) pts = [pts];
    points.push(...pts);
  }

  if (points.length < 2) throw new Error('GPX file has insufficient trackpoints');

  // Extract time series
  let totalDistance = 0;
  let totalElevGain = 0;
  let maxSpeed = 0;
  let hrSum = 0, hrCount = 0, hrMax = 0;
  let cadSum = 0, cadCount = 0;
  let powerSum = 0, powerCount = 0, powerMax = 0;
  const speeds = [];
  const gpsCoords = [];

  for (let i = 0; i < points.length; i++) {
    const pt = points[i];
    const ptLat = parseFloat(pt['@_lat']), ptLon = parseFloat(pt['@_lon']);
    if (!isNaN(ptLat) && !isNaN(ptLon)) gpsCoords.push([ptLat, ptLon]);

    if (i > 0) {
      const prev = points[i - 1];
      const lat1 = parseFloat(prev['@_lat']), lon1 = parseFloat(prev['@_lon']);
      const lat2 = parseFloat(pt['@_lat']), lon2 = parseFloat(pt['@_lon']);
      const dist = haversine(lat1, lon1, lat2, lon2);
      totalDistance += dist;

      const ele1 = parseFloat(prev.ele) || 0;
      const ele2 = parseFloat(pt.ele) || 0;
      const elevDiff = ele2 - ele1;
      if (elevDiff > 0) totalElevGain += elevDiff;

      if (pt.time && prev.time) {
        const dt = (new Date(pt.time) - new Date(prev.time)) / 1000;
        if (dt > 0) {
          const speed = dist / dt;
          speeds.push(speed);
          if (speed > maxSpeed) maxSpeed = speed;
        }
      }
    }

    // Extensions (Garmin TrackPointExtension)
    const ext = pt.extensions;
    if (ext) {
      const tpx = ext.TrackPointExtension || ext;
      const hr = parseInt(tpx.hr) || parseInt(tpx.heartrate) || 0;
      if (hr > 0) { hrSum += hr; hrCount++; if (hr > hrMax) hrMax = hr; }
      const cad = parseInt(tpx.cad) || parseInt(tpx.cadence) || 0;
      if (cad > 0) { cadSum += cad; cadCount++; }
      const pwr = parseInt(tpx.power) || parseInt(ext.power) || 0;
      if (pwr > 0) { powerSum += pwr; powerCount++; if (pwr > powerMax) powerMax = pwr; }
    }
  }

  const firstTime = points[0].time ? new Date(points[0].time) : null;
  const lastTime = points[points.length - 1].time ? new Date(points[points.length - 1].time) : null;
  const elapsedTime = firstTime && lastTime ? Math.round((lastTime - firstTime) / 1000) : 0;
  const avgSpeed = speeds.length > 0 ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0;

  const activity = {
    name: track.name || null,
    sport_type: guessGPXSport(avgSpeed),
    start_date: firstTime ? firstTime.toISOString() : null,
    distance: totalDistance,
    moving_time: elapsedTime, // GPX doesn't distinguish moving vs elapsed
    elapsed_time: elapsedTime,
    total_elevation_gain: Math.round(totalElevGain),
    average_speed: avgSpeed,
    max_speed: maxSpeed,
    average_watts: powerCount > 0 ? Math.round(powerSum / powerCount) : null,
    max_watts: powerMax || null,
    average_heartrate: hrCount > 0 ? Math.round(hrSum / hrCount) : null,
    max_heartrate: hrMax || null,
    suffer_score: null,
    external_id: null,
    normalized_power: null,
    avg_cadence: cadCount > 0 ? Math.round(cadSum / cadCount) : null,
    max_cadence: null,
    calories: null,
    lap_data: null,
    power_curve: null,
    route_polyline: gpsCoords.length > 1 ? encodePolyline(simplify(gpsCoords, 0.00003)) : null,
  };

  // Extract per-second streams for ride analysis
  activity.streams = extractStreamsFromGPX(points);

  return activity;
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function guessGPXSport(avgSpeedMps) {
  if (avgSpeedMps > 5) return 'Ride';    // > 18 km/h
  if (avgSpeedMps > 2) return 'Run';     // > 7.2 km/h
  if (avgSpeedMps > 0.8) return 'Walk';  // > 2.9 km/h
  return 'Workout';
}

// --- TCX ---

function parseTCX(buffer) {
  const xml = Buffer.from(buffer).toString('utf-8');
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
  });
  const doc = parser.parse(xml);
  const db = doc.TrainingCenterDatabase;
  if (!db) throw new Error('Invalid TCX file: no <TrainingCenterDatabase> element');

  const activities = db.Activities;
  if (!activities) throw new Error('TCX file contains no activities');

  let activity = activities.Activity;
  if (Array.isArray(activity)) activity = activity[0];
  if (!activity) throw new Error('TCX file has no activity');

  const sport = activity['@_Sport'] || 'Other';
  const sportMap = { Running: 'Run', Biking: 'Ride', Other: 'Workout' };

  let laps = activity.Lap;
  if (!laps) throw new Error('TCX activity has no laps');
  if (!Array.isArray(laps)) laps = [laps];

  let totalTime = 0, totalDistance = 0, totalCalories = 0;
  let totalElevGain = 0;
  let maxSpeed = 0;
  let hrSum = 0, hrWeight = 0, hrMax = 0;
  let cadSum = 0, cadWeight = 0;
  let powerSum = 0, powerWeight = 0, powerMax = 0;
  const lapData = [];

  for (const lap of laps) {
    const time = parseFloat(lap.TotalTimeSeconds) || 0;
    const dist = parseFloat(lap.DistanceMeters) || 0;
    totalTime += time;
    totalDistance += dist;
    totalCalories += parseInt(lap.Calories) || 0;

    const lapMaxSpeed = parseFloat(lap.MaximumSpeed) || 0;
    if (lapMaxSpeed > maxSpeed) maxSpeed = lapMaxSpeed;

    const avgHr = parseFloat(lap.AverageHeartRateBpm?.Value) || 0;
    const maxHr = parseFloat(lap.MaximumHeartRateBpm?.Value) || 0;
    if (avgHr > 0) { hrSum += avgHr * time; hrWeight += time; }
    if (maxHr > hrMax) hrMax = maxHr;

    const cad = parseFloat(lap.Cadence) || 0;
    if (cad > 0) { cadSum += cad * time; cadWeight += time; }

    // Power from extensions
    const ext = lap.Extensions;
    const lx = ext?.LX || ext?.ActivityLapExtension || {};
    const avgWatts = parseFloat(lx.AvgWatts) || 0;
    const maxWatts = parseFloat(lx.MaxWatts) || 0;
    if (avgWatts > 0) { powerSum += avgWatts * time; powerWeight += time; }
    if (maxWatts > powerMax) powerMax = maxWatts;

    // Elevation from trackpoints
    let lapElevGain = 0;
    let tracks = lap.Track;
    if (tracks) {
      if (!Array.isArray(tracks)) tracks = [tracks];
      for (const track of tracks) {
        let pts = track.Trackpoint;
        if (!pts) continue;
        if (!Array.isArray(pts)) pts = [pts];
        let prevAlt = null;
        for (const pt of pts) {
          const alt = parseFloat(pt.AltitudeMeters);
          if (!isNaN(alt) && prevAlt != null && alt > prevAlt) {
            lapElevGain += alt - prevAlt;
          }
          if (!isNaN(alt)) prevAlt = alt;
        }
      }
    }
    totalElevGain += lapElevGain;

    lapData.push({
      distance: dist,
      duration: Math.round(time),
      avg_speed: time > 0 ? dist / time : 0,
      avg_power: avgWatts || null,
      avg_hr: avgHr || null,
      avg_cadence: cad || null,
      elevation_gain: Math.round(lapElevGain),
    });
  }

  const startDate = activity.Id || laps[0]?.['@_StartTime'] || null;

  return {
    name: null,
    sport_type: sportMap[sport] || sport,
    start_date: startDate ? new Date(startDate).toISOString() : null,
    distance: totalDistance,
    moving_time: Math.round(totalTime),
    elapsed_time: Math.round(totalTime),
    total_elevation_gain: Math.round(totalElevGain),
    average_speed: totalTime > 0 ? totalDistance / totalTime : 0,
    max_speed: maxSpeed,
    average_watts: powerWeight > 0 ? Math.round(powerSum / powerWeight) : null,
    max_watts: powerMax || null,
    average_heartrate: hrWeight > 0 ? Math.round(hrSum / hrWeight) : null,
    max_heartrate: hrMax || null,
    suffer_score: null,
    external_id: null,
    normalized_power: null,
    avg_cadence: cadWeight > 0 ? Math.round(cadSum / cadWeight) : null,
    max_cadence: null,
    calories: totalCalories || null,
    lap_data: lapData.length > 0 ? lapData : null,
    power_curve: null,
  };
}
