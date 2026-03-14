const leaderboard = document.getElementById('leaderboard');
const filterAthlete = document.getElementById('filter-athlete');
const filterSport = document.getElementById('filter-sport');
const sortBy = document.getElementById('sort-by');

function formatDistance(meters) {
  if (!meters || meters === 0) return '--';
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(2)} km`;
}

function formatDuration(seconds) {
  if (!seconds) return '--';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s}s`;
}

function formatSpeed(mps) {
  if (!mps || mps === 0) return '--';
  return `${(mps * 3.6).toFixed(1)} km/h`;
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function renderCard(a) {
  const athlete = a.athletes;
  const stats = [];

  if (a.distance > 0) stats.push({ label: 'Distance', value: formatDistance(a.distance) });
  stats.push({ label: 'Time', value: formatDuration(a.moving_time) });
  if (a.average_speed > 0) stats.push({ label: 'Avg Speed', value: formatSpeed(a.average_speed) });
  if (a.elevation_gain > 0) stats.push({ label: 'Elevation', value: `${Math.round(a.elevation_gain)}m` });
  if (a.average_watts) stats.push({ label: 'Avg Watts', value: `${a.average_watts}W` });
  if (a.suffer_score) stats.push({ label: 'Suffer', value: a.suffer_score });

  const statsHTML = stats
    .map((s) => `<div class="stat"><div class="stat-label">${s.label}</div><div class="stat-value">${s.value}</div></div>`)
    .join('');

  return `
    <div class="activity-card">
      <div class="card-header">
        <img src="${athlete?.profile_pic || ''}" alt="" onerror="this.style.display='none'">
        <span class="athlete-name">${athlete?.firstname || '?'} ${athlete?.lastname || ''}</span>
        <span class="activity-date">${formatDate(a.start_date)}</span>
        <span class="activity-type">${a.sport_type}</span>
      </div>
      <div class="activity-name">"${a.name}"</div>
      <div class="stats-grid">${statsHTML}</div>
      <div class="roast">${a.roast}</div>
    </div>
  `;
}

async function loadLeaderboard() {
  const params = new URLSearchParams();
  if (filterAthlete.value) params.set('athlete_id', filterAthlete.value);
  if (filterSport.value) params.set('sport_type', filterSport.value);
  if (sortBy.value) params.set('sort', sortBy.value);

  leaderboard.innerHTML = '<div class="loading">Loading roasts...</div>';

  try {
    const res = await fetch(`/api/get-leaderboard?${params}`);
    const data = await res.json();

    // Populate athlete filter
    if (data.athletes && filterAthlete.options.length <= 1) {
      for (const a of data.athletes) {
        const opt = document.createElement('option');
        opt.value = a.id;
        opt.textContent = `${a.firstname} ${a.lastname}`;
        filterAthlete.appendChild(opt);
      }
    }

    if (!data.activities?.length) {
      leaderboard.innerHTML = '<div class="empty-state"><p>No roasts yet. Connect your Strava and go for a ride (or a gentle stroll — we judge those too).</p></div>';
      return;
    }

    leaderboard.innerHTML = data.activities.map(renderCard).join('');
  } catch (err) {
    leaderboard.innerHTML = '<div class="empty-state"><p>Failed to load. Try again later.</p></div>';
    console.error(err);
  }
}

filterAthlete.addEventListener('change', loadLeaderboard);
filterSport.addEventListener('change', loadLeaderboard);
sortBy.addEventListener('change', loadLeaderboard);

loadLeaderboard();
