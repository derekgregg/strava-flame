const leaderboard = document.getElementById('leaderboard');
const filterUser = document.getElementById('filter-user');
const filterSport = document.getElementById('filter-sport');
const sortBy = document.getElementById('sort-by');
const userNav = document.getElementById('user-nav');
const userGreeting = document.getElementById('user-greeting');
const connectButtons = document.getElementById('connect-buttons');

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

function platformBadges(activity) {
  const links = activity.platform_links || {};
  const labels = { strava: 'Strava', wahoo: 'Wahoo', garmin: 'Garmin', upload: 'Upload' };
  const classes = { strava: 'badge-strava', wahoo: 'badge-wahoo', garmin: 'badge-garmin', upload: 'badge-upload' };

  const platforms = Object.keys(links);

  // Fallback for legacy data without platform_links
  if (!platforms.length && activity.source_platform) {
    platforms.push(activity.source_platform);
  }

  return platforms
    .map(p => `<span class="platform-badge ${classes[p] || ''}">${labels[p] || p}</span>`)
    .join(' ');
}

function activityLinks(activity) {
  const links = activity.platform_links || {};
  const parts = [];

  if (links.strava) {
    parts.push(`<a href="https://www.strava.com/activities/${links.strava}" target="_blank" rel="noopener" class="view-on-strava">View on Strava</a>`);
  }
  if (links.garmin) {
    parts.push(`<a href="https://connect.garmin.com/modern/activity/${links.garmin}" target="_blank" rel="noopener" class="view-on-garmin">View on Garmin</a>`);
  }
  if (links.wahoo) {
    parts.push(`<span class="view-on-wahoo">Recorded with Wahoo</span>`);
  }

  // Legacy fallback
  if (!parts.length && activity.source_platform === 'strava') {
    const id = activity.source_activity_id || activity.id;
    parts.push(`<a href="https://www.strava.com/activities/${id}" target="_blank" rel="noopener" class="view-on-strava">View on Strava</a>`);
  }

  return parts.join(' ');
}

function renderCard(a) {
  // Support both new (users) and legacy (athletes) schema
  const user = a.users || a.athletes;
  const displayName = user?.display_name || `${user?.firstname || '?'} ${user?.lastname || ''}`;
  const profilePic = user?.profile_pic || '';

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
        ${profilePic ? `<img src="${profilePic}" alt="" onerror="this.style.display='none'">` : ''}
        <span class="athlete-name">${displayName}</span>
        <span class="activity-date">${formatDate(a.start_date)}</span>
        ${platformBadges(a)}
        <span class="activity-type">${a.sport_type}</span>
      </div>
      <div class="activity-name">"${a.name}"</div>
      <div class="stats-grid">${statsHTML}</div>
      <div class="roast">${a.roast}</div>
      ${activityLinks(a)}
    </div>
  `;
}

async function checkAuth() {
  try {
    const res = await fetch('/api/get-user');
    const data = await res.json();
    if (data.user) {
      userNav.classList.remove('hidden');
      userGreeting.textContent = data.user.display_name;
      // Hide connect buttons for already-connected platforms
      if (data.connections) {
        const connected = data.connections.map(c => c.platform);
        if (connected.includes('strava')) {
          const btn = document.querySelector('.strava-btn');
          if (btn) btn.classList.add('hidden');
        }
        if (connected.includes('wahoo')) {
          const btn = document.querySelector('.wahoo-btn');
          if (btn) btn.classList.add('hidden');
        }
        if (connected.includes('garmin')) {
          const btn = document.querySelector('.garmin-btn');
          if (btn) btn.classList.add('hidden');
        }
        // If all connected, hide the connect buttons container
        if (connected.length >= 3) connectButtons.classList.add('hidden');
      }
    }
  } catch {
    // Not logged in — that's fine
  }
}

async function loadLeaderboard() {
  const params = new URLSearchParams();
  if (filterUser.value) params.set('user_id', filterUser.value);
  if (filterSport.value) params.set('sport_type', filterSport.value);
  if (sortBy.value) params.set('sort', sortBy.value);

  leaderboard.innerHTML = '<div class="loading">Loading commentary...</div>';

  try {
    const res = await fetch(`/api/get-leaderboard?${params}`);
    const data = await res.json();

    // Populate user filter
    const users = data.users || data.athletes || [];
    if (users.length && filterUser.options.length <= 1) {
      for (const u of users) {
        const opt = document.createElement('option');
        opt.value = u.id;
        opt.textContent = u.display_name || `${u.firstname} ${u.lastname}`;
        filterUser.appendChild(opt);
      }
    }

    if (!data.activities?.length) {
      leaderboard.innerHTML = '<div class="empty-state"><p>No commentary yet. Connect a platform and go for a ride (or a gentle stroll — we judge those too).</p></div>';
      return;
    }

    leaderboard.innerHTML = data.activities.map(renderCard).join('');
  } catch (err) {
    leaderboard.innerHTML = '<div class="empty-state"><p>Failed to load. Try again later.</p></div>';
    console.error(err);
  }
}

filterUser.addEventListener('change', loadLeaderboard);
filterSport.addEventListener('change', loadLeaderboard);
sortBy.addEventListener('change', loadLeaderboard);

checkAuth();
loadLeaderboard();
