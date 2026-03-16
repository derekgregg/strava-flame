const content = document.getElementById('upload-content');

async function init() {
  // Check auth
  let userData;
  try {
    const res = await fetch('/api/get-user');
    userData = await res.json();
  } catch {
    content.innerHTML = '<div class="empty-state"><p>Failed to load.</p></div>';
    return;
  }

  if (!userData.user) {
    content.innerHTML = `
      <div class="empty-state">
        <p>You need to be logged in to upload activities.</p>
        <a href="/api/google-auth" class="connect-btn google-btn" style="margin-top: 20px;">Sign in with Google</a>
      </div>
    `;
    return;
  }

  content.innerHTML = `
    <div class="upload-section">
      <div class="upload-zone" id="drop-zone">
        <div class="upload-icon">+</div>
        <p>Drop a .fit, .gpx, or .tcx file here</p>
        <p class="text-muted">or click to browse</p>
        <input type="file" id="file-input" accept=".fit,.gpx,.tcx" hidden>
      </div>

      <div class="upload-fields" id="upload-fields" style="display: none;">
        <div class="settings-field">
          <label for="activity-name">Activity Name <span class="text-muted">(optional)</span></label>
          <input type="text" id="activity-name" placeholder="e.g. Morning Ride">
        </div>
        <div class="settings-field">
          <label for="activity-description">Description <span class="text-muted">(optional — Le Directeur will use this as ammo)</span></label>
          <textarea id="activity-description" placeholder="e.g. Felt great until the last climb" rows="2" style="padding: 8px 12px; border: 1px solid var(--border); border-radius: 4px; background: var(--bg); color: var(--text); font-family: inherit; font-size: 0.9rem; width: 100%; max-width: 400px; resize: vertical;"></textarea>
        </div>
        <div class="upload-file-info" id="file-info"></div>
        <button class="connect-btn" id="upload-btn">Upload & Analyze</button>
      </div>

      <div id="upload-status" style="display: none;"></div>
    </div>

    <div class="upload-section" style="margin-top: 32px;">
      <h2>Recent Uploads</h2>
      <div id="recent-uploads">
        <div class="loading">Loading...</div>
      </div>
    </div>
  `;

  setupUpload();
  loadRecentUploads();
}

function setupUpload() {
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');
  const fields = document.getElementById('upload-fields');
  const fileInfo = document.getElementById('file-info');
  const uploadBtn = document.getElementById('upload-btn');
  const nameInput = document.getElementById('activity-name');

  let selectedFile = null;

  dropZone.addEventListener('click', () => fileInput.click());

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) selectFile(file);
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) selectFile(fileInput.files[0]);
  });

  function selectFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['fit', 'gpx', 'tcx'].includes(ext)) {
      alert('Unsupported format. Please use .fit, .gpx, or .tcx files.');
      return;
    }
    if (file.size > 4.5 * 1024 * 1024) {
      alert('File is too large (max ~4.5MB). Try a .FIT file instead — they are much smaller.');
      return;
    }
    selectedFile = file;
    const sizeMB = (file.size / 1024 / 1024).toFixed(2);
    fileInfo.innerHTML = `<span class="platform-badge badge-${ext === 'fit' ? 'garmin' : ext === 'tcx' ? 'wahoo' : 'strava'}">.${ext.toUpperCase()}</span> ${file.name} (${sizeMB} MB)`;
    nameInput.value = '';
    fields.style.display = 'block';
    dropZone.style.display = 'none';
  }

  uploadBtn.addEventListener('click', async () => {
    if (!selectedFile) return;

    uploadBtn.disabled = true;
    uploadBtn.textContent = 'Uploading...';
    showProgress('uploading');

    try {
      const buffer = await selectedFile.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);

      const res = await fetch('/api/upload-activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: selectedFile.name,
          data: base64,
          name: nameInput.value.trim() || undefined,
          description: document.getElementById('activity-description').value.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        showStatus('error', errData.error || `Server error (${res.status})`);
        uploadBtn.disabled = false;
        uploadBtn.textContent = 'Upload & Analyze';
        return;
      }

      const data = await res.json();
      if (data.error) {
        showStatus('error', data.error);
        uploadBtn.disabled = false;
        uploadBtn.textContent = 'Upload & Analyze';
        return;
      }

      showProgress('uploaded');
      pollStatus(data.uploadId);
    } catch (err) {
      showStatus('error', 'Upload failed. Please try again.');
      uploadBtn.disabled = false;
      uploadBtn.textContent = 'Upload & Analyze';
    }
  });
}

const STEPS = [
  { key: 'uploading', label: 'Uploading file' },
  { key: 'uploaded', label: 'File uploaded' },
  { key: 'processing', label: 'Parsing activity data' },
  { key: 'generating', label: 'Le Directeur is reviewing your effort' },
  { key: 'complete', label: 'Commentary ready' },
];

function showProgress(currentStep) {
  const el = document.getElementById('upload-status');
  el.style.display = 'block';
  el.className = 'upload-status-msg';

  const currentIdx = STEPS.findIndex(s => s.key === currentStep);

  el.innerHTML = `<div class="progress-steps">
    ${STEPS.map((step, i) => {
      let cls = 'step-pending';
      let icon = `<span class="step-num">${i + 1}</span>`;
      if (i < currentIdx) {
        cls = 'step-done';
        icon = '<span class="step-check">&#10003;</span>';
      } else if (i === currentIdx) {
        cls = 'step-active';
        icon = '<span class="step-spinner"></span>';
      }
      return `<div class="progress-step ${cls}">${icon}<span class="step-label">${step.label}</span></div>`;
    }).join('')}
  </div>`;
}

function showStatus(type, message) {
  const el = document.getElementById('upload-status');
  el.style.display = 'block';
  el.className = `upload-status-msg ${type}`;
  el.innerHTML = type === 'error'
    ? `<p style="color: var(--flame);">${message}</p>`
    : `<p style="color: var(--toxic);">${message}</p>`;
}

async function pollStatus(uploadId) {
  let attempts = 0;
  const maxAttempts = 30; // 60 seconds
  let lastStatus = 'uploaded';

  const interval = setInterval(async () => {
    attempts++;
    try {
      const res = await fetch(`/api/upload-status?id=${uploadId}`);
      const data = await res.json();

      // Map backend status to progress steps
      if (data.status === 'processing' && lastStatus === 'uploaded') {
        showProgress('processing');
        lastStatus = 'processing';
      }
      if (data.status === 'processing' && attempts > 3) {
        showProgress('generating');
        lastStatus = 'generating';
      }

      if (data.status === 'complete') {
        clearInterval(interval);
        showProgress('complete');
        setTimeout(() => loadRecentUploads(), 1500);
      } else if (data.status === 'error') {
        clearInterval(interval);
        showStatus('error', data.error || 'Processing failed.');
      } else if (attempts >= maxAttempts) {
        clearInterval(interval);
        showStatus('error', 'Processing is taking longer than expected. Check back in a minute.');
      }
    } catch {
      // Network error — keep polling
    }
  }, 2000);
}

async function loadRecentUploads() {
  const el = document.getElementById('recent-uploads');
  try {
    const res = await fetch('/api/get-feed?limit=10');
    const data = await res.json();

    const uploads = (data.activities || []).filter(a => a.platform_links?.upload);
    if (!uploads.length) {
      el.innerHTML = '<p class="text-muted">No uploaded activities yet.</p>';
      return;
    }

    el.innerHTML = uploads.map(a => `
      <div class="feed-item">
        <div class="feed-header">
          <span class="feed-name">${a.name}</span>
          <span class="feed-date">${new Date(a.start_date).toLocaleDateString()}</span>
          <span class="platform-badge badge-upload">Upload</span>
        </div>
        ${a.roast ? `<div class="roast">${a.roast}</div>` : '<p class="text-muted">Processing...</p>'}
      </div>
    `).join('');
  } catch {
    el.innerHTML = '<p class="text-muted">Failed to load.</p>';
  }
}

init();
