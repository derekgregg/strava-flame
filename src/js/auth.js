const msg = document.getElementById('callback-message');
const params = new URLSearchParams(window.location.search);

if (params.get('success')) {
  const name = params.get('name') || 'Athlete';
  msg.innerHTML = `
    <h2>Welcome, ${name}!</h2>
    <p>Your Strava account is connected. Every activity you post will now be roasted mercilessly.</p>
    <p style="margin-top: 20px;"><a href="/">View the leaderboard</a></p>
  `;
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
