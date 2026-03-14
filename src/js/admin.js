const loginForm = document.getElementById('login-form');
const adminPanel = document.getElementById('admin-panel');
const athletesList = document.getElementById('athletes-list');
const loginBtn = document.getElementById('login-btn');
const secretInput = document.getElementById('admin-secret');

let adminSecret = sessionStorage.getItem('admin_secret') || '';

if (adminSecret) {
  showPanel();
}

loginBtn.addEventListener('click', () => {
  adminSecret = secretInput.value.trim();
  if (!adminSecret) return;
  sessionStorage.setItem('admin_secret', adminSecret);
  showPanel();
});

secretInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loginBtn.click();
});

async function showPanel() {
  loginForm.style.display = 'none';
  adminPanel.style.display = 'block';
  await loadAthletes();
}

function authHeaders() {
  return { Authorization: `Bearer ${adminSecret}`, 'Content-Type': 'application/json' };
}

async function loadAthletes() {
  try {
    const res = await fetch('/api/admin-athletes', { headers: authHeaders() });
    if (res.status === 401) {
      sessionStorage.removeItem('admin_secret');
      adminSecret = '';
      loginForm.style.display = 'block';
      adminPanel.style.display = 'none';
      return;
    }
    const athletes = await res.json();
    renderAthletes(athletes);
  } catch (err) {
    athletesList.innerHTML = '<p>Failed to load athletes.</p>';
    console.error(err);
  }
}

function renderAthletes(athletes) {
  if (!athletes.length) {
    athletesList.innerHTML = '<div class="empty-state"><p>No athletes connected yet.</p></div>';
    return;
  }

  athletesList.innerHTML = athletes
    .map(
      (a) => `
    <div class="athlete-row">
      <img src="${a.profile_pic || ''}" alt="" onerror="this.style.display='none'">
      <span class="name">${a.firstname} ${a.lastname}</span>
      <span class="${a.is_tracked ? 'badge-tracked' : 'badge-untracked'}">
        ${a.is_tracked ? 'Tracked' : 'Paused'}
      </span>
      <span class="${a.share_with_group ? 'badge-tracked' : 'badge-untracked'}">
        ${a.share_with_group ? 'Sharing' : 'Private'}
      </span>
      <button onclick="toggleAthlete(${a.id}, ${!a.is_tracked})">
        ${a.is_tracked ? 'Pause' : 'Track'}
      </button>
      <button class="danger" onclick="deleteAthlete(${a.id}, '${a.firstname}')">Remove</button>
    </div>
  `
    )
    .join('');
}

window.toggleAthlete = async (id, tracked) => {
  await fetch('/api/admin-athletes', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ athleteId: id, is_tracked: tracked }),
  });
  loadAthletes();
};

window.deleteAthlete = async (id, name) => {
  if (!confirm(`Remove ${name} and all their activities?`)) return;
  await fetch('/api/admin-athletes', {
    method: 'DELETE',
    headers: authHeaders(),
    body: JSON.stringify({ athleteId: id }),
  });
  loadAthletes();
};
