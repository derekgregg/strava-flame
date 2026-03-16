const msg = document.getElementById('callback-message');
const params = new URLSearchParams(window.location.search);

if (params.get('success')) {
  const name = params.get('name') || 'Athlete';
  const athleteId = params.get('athlete_id') || '';
  msg.innerHTML = `
    <h2>Welcome, ${name}!</h2>
    <p>Your Strava account is connected. Your recent activities are being synced now.</p>
    <div style="margin: 30px 0; padding: 20px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; text-align: left;">
      <label style="display: flex; align-items: center; gap: 12px; cursor: pointer;">
        <input type="checkbox" id="share-toggle" style="width: 20px; height: 20px; accent-color: var(--toxic);">
        <span><strong>Share my activities with the group</strong><br>
        <span style="color: var(--text-muted); font-size: 0.85rem;">Allow other connected athletes to see your activities and roasts on the leaderboard.</span></span>
      </label>
      <div style="margin-top: 16px;">
        <label for="weight-input" style="display: block; margin-bottom: 6px;"><strong>Weight (kg)</strong> <span style="color: var(--text-muted); font-size: 0.85rem;">— optional, used for power-to-weight roasts</span></label>
        <input type="number" id="weight-input" min="30" max="200" step="0.1" placeholder="e.g. 75" style="padding: 8px 12px; border: 1px solid var(--border); border-radius: 4px; background: var(--bg); color: var(--text); font-size: 1rem; width: 120px;">
      </div>
    </div>
    <button class="connect-btn" id="save-prefs" disabled>Save & View Leaderboard</button>
  `;

  const toggle = document.getElementById('share-toggle');
  const weightInput = document.getElementById('weight-input');
  const saveBtn = document.getElementById('save-prefs');

  toggle.addEventListener('change', () => {
    saveBtn.disabled = false;
  });
  weightInput.addEventListener('input', () => {
    saveBtn.disabled = false;
  });

  saveBtn.addEventListener('click', async () => {
    saveBtn.textContent = 'Saving...';
    saveBtn.disabled = true;
    const body = {
      athleteId: parseInt(athleteId),
      share_with_group: toggle.checked,
    };
    const w = parseFloat(weightInput.value);
    if (w > 0) body.weight = w;
    try {
      await fetch('/api/athlete-preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      console.error('Failed to save preferences:', err);
    }
    window.location.href = '/';
  });
} else if (params.get('error')) {
  msg.className = 'callback-msg error';
  msg.innerHTML = `
    <h2>Connection Failed</h2>
    <p>Error: ${params.get('error')}</p>
    <p style="margin-top: 20px;"><a href="/">Try again</a></p>
  `;
} else {
  msg.innerHTML = `
    <p>Nothing to see here.</p>
    <p style="margin-top: 20px;"><a href="/">Go to leaderboard</a></p>
  `;
}
