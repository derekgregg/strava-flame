const content = document.getElementById('settings-content');

async function loadSettings() {
  let data;
  try {
    const res = await fetch('/api/get-user');
    data = await res.json();
  } catch {
    content.innerHTML = '<div class="empty-state"><p>Failed to load settings.</p></div>';
    return;
  }

  if (!data.user) {
    content.innerHTML = `
      <div class="empty-state">
        <p>You're not logged in. Connect a platform to get started.</p>
        <div class="connect-buttons" style="margin-top: 20px; justify-content: center;">
          <a href="/api/strava-auth" class="connect-btn strava-btn">Connect Strava</a>
          <span class="connect-btn wahoo-btn" style="pointer-events: none; opacity: 0.4;">Wahoo (coming soon)</span>
          <span class="connect-btn garmin-btn" style="pointer-events: none; opacity: 0.4;">Garmin (not available)</span>
        </div>
      </div>
    `;
    return;
  }

  const user = data.user;
  const connections = data.connections || [];
  const connectedPlatforms = connections.map(c => c.platform);

  const isWelcome = new URLSearchParams(window.location.search).get('welcome');

  content.innerHTML = `
    ${isWelcome ? `<div class="settings-section"><div class="settings-card" style="border-color: var(--gold);"><p style="color: var(--accent);">Welcome to Le Directeur! Set up your profile so we can judge you properly.</p></div></div>` : ''}
    <div class="settings-section">
      <h2>Profile</h2>
      <div class="settings-card">
        <div class="settings-field">
          <label for="display-name">Display Name</label>
          <input type="text" id="display-name" value="${user.display_name || ''}" placeholder="Your name">
        </div>
        <div class="settings-field">
          <label for="height-input">Height (cm) <span class="text-muted">— so Le Directeur knows if you're a climber or a sprinter build</span></label>
          <input type="number" id="height-input" value="${user.height || ''}" min="120" max="220" step="1" placeholder="e.g. 183">
        </div>
        <div class="settings-field">
          <label for="weight-input">Weight (kg) <span class="text-muted">— for power-to-weight commentary</span></label>
          <input type="number" id="weight-input" value="${user.weight || ''}" min="30" max="200" step="0.1" placeholder="e.g. 75">
        </div>
        <div class="settings-field">
          <label for="ftp-input">FTP (watts) <span class="text-muted">— Le Directeur will judge your efforts against this</span></label>
          <input type="number" id="ftp-input" value="${user.ftp || ''}" min="50" max="500" step="1" placeholder="e.g. 250">
        </div>
        <div class="settings-field">
          <label class="checkbox-label">
            <input type="checkbox" id="share-toggle" ${user.share_with_group ? 'checked' : ''}>
            <span>Share my activities with the group leaderboard</span>
          </label>
        </div>
        <button id="save-profile" class="connect-btn">Save Profile</button>
      </div>
    </div>

    <div class="settings-section">
      <h2>Connected Platforms</h2>
      <div class="settings-card">
        ${renderPlatformRow('strava', 'Strava', connectedPlatforms, connections)}
        ${renderPlatformRow('wahoo', 'Wahoo', connectedPlatforms, connections)}
        ${renderPlatformRow('garmin', 'Garmin', connectedPlatforms, connections)}
        ${connectedPlatforms.length ? `
          <div style="margin-top: 12px; text-align: right;">
            <button id="sync-btn" class="connect-btn small">Sync Activities</button>
          </div>
        ` : ''}
      </div>
    </div>

    <div class="settings-section">
      <h2>My Feed</h2>
      <div id="my-feed">
        <div class="loading">Loading your activities...</div>
      </div>
    </div>

    <div class="settings-section">
      <a href="/api/logout" class="disconnect-btn">Log Out</a>
    </div>
  `;

  // Bind events
  document.getElementById('save-profile').addEventListener('click', saveProfile);

  const syncBtn = document.getElementById('sync-btn');
  if (syncBtn) syncBtn.addEventListener('click', syncActivities);

  document.querySelectorAll('.disconnect-btn').forEach(btn => {
    btn.addEventListener('click', () => disconnectPlatform(btn.dataset.platform));
  });

  loadFeed();
}

function renderPlatformRow(platform, label, connected, connections) {
  const isConnected = connected.includes(platform);
  const conn = connections.find(c => c.platform === platform);
  const unavailable = platform === 'garmin' || platform === 'wahoo';

  if (isConnected) {
    const date = conn ? new Date(conn.connected_at).toLocaleDateString() : '';
    return `
      <div class="platform-row">
        <span class="platform-name">${label}</span>
        <span class="badge-tracked">Connected ${date}</span>
        <button class="disconnect-btn danger" data-platform="${platform}">Disconnect</button>
      </div>
    `;
  }

  if (unavailable) {
    const reason = platform === 'garmin' ? 'Not available' : 'Coming soon';
    return `
      <div class="platform-row" style="opacity: 0.5;">
        <span class="platform-name">${label}</span>
        <span class="badge-untracked">${reason}</span>
        <span class="connect-btn small" style="pointer-events: none; opacity: 0.4;">Connect</span>
      </div>
    `;
  }

  return `
    <div class="platform-row">
      <span class="platform-name">${label}</span>
      <span class="badge-untracked">Not connected</span>
      <a href="/api/${platform}-auth" class="connect-btn small">Connect</a>
    </div>
  `;
}

async function saveProfile() {
  const btn = document.getElementById('save-profile');
  btn.textContent = 'Saving...';
  btn.disabled = true;

  const body = {
    display_name: document.getElementById('display-name').value.trim(),
    share_with_group: document.getElementById('share-toggle').checked,
  };

  const h = parseFloat(document.getElementById('height-input').value);
  if (h > 0) body.height = h;
  else body.height = 0;

  const w = parseFloat(document.getElementById('weight-input').value);
  if (w > 0) body.weight = w;
  else body.weight = 0;

  const ftp = parseInt(document.getElementById('ftp-input').value);
  if (ftp > 0) body.ftp = ftp;
  else body.ftp = 0;

  try {
    await fetch('/api/user-preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    btn.textContent = 'Saved!';
    setTimeout(() => {
      btn.textContent = 'Save Profile';
      btn.disabled = false;
    }, 1500);
  } catch (err) {
    console.error('Save failed:', err);
    btn.textContent = 'Save Profile';
    btn.disabled = false;
  }
}

async function disconnectPlatform(platform) {
  if (!confirm(`Disconnect ${platform}? This will remove all ${platform}-sourced activities.`)) return;

  try {
    const res = await fetch('/api/disconnect-platform', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform }),
    });
    const data = await res.json();
    if (data.error) {
      alert(data.error);
    } else {
      loadSettings(); // Refresh
    }
  } catch (err) {
    console.error('Disconnect failed:', err);
  }
}

async function loadFeed() {
  const feed = document.getElementById('my-feed');
  try {
    const res = await fetch('/api/get-feed');
    const data = await res.json();

    const pending = data.pending_uploads || [];
    const activities = data.activities || [];

    if (!activities.length && !pending.length) {
      feed.innerHTML = '<p class="text-muted">No activities yet. <a href="/upload.html">Upload a file</a> or connect a platform and go ride!</p>';
      return;
    }

    let html = '';

    if (pending.length) {
      html += pending.map(u => `
        <div class="feed-item feed-pending">
          <div class="feed-header">
            <span class="step-spinner"></span>
            <span class="feed-name">${u.activity_name || u.filename}</span>
            <span class="text-muted">${u.status === 'pending' ? 'Queued' : 'Processing...'}</span>
          </div>
        </div>
      `).join('');
    }

    html += activities.map(a => `
      <div class="feed-item">
        <div class="feed-header">
          <span class="feed-name">${a.name}</span>
          <span class="feed-date">${new Date(a.start_date).toLocaleDateString()}</span>
          ${Object.keys(a.platform_links || {}).map(p => `<span class="platform-badge badge-${p}">${p}</span>`).join(' ') || `<span class="platform-badge badge-${a.source_platform || 'strava'}">${a.source_platform || 'strava'}</span>`}
        </div>
        ${a.roast ? `<div class="roast">${a.roast}</div>` : '<p class="text-muted">Awaiting commentary...</p>'}
      </div>
    `).join('');

    feed.innerHTML = html;
  } catch {
    feed.innerHTML = '<p class="text-muted">Failed to load feed.</p>';
  }
}

async function syncActivities() {
  const btn = document.getElementById('sync-btn');
  btn.textContent = 'Syncing...';
  btn.disabled = true;

  try {
    const res = await fetch('/api/sync-activities', { method: 'POST' });
    const data = await res.json();
    if (data.error) {
      btn.textContent = 'Sync failed';
    } else {
      btn.textContent = 'Synced!';
      setTimeout(() => loadFeed(), 3000);
    }
  } catch {
    btn.textContent = 'Sync failed';
  }

  setTimeout(() => {
    btn.textContent = 'Sync Activities';
    btn.disabled = false;
  }, 3000);
}

loadSettings();
