/**
 * Session management for Neutronium Leaderboard
 * Handles active game session view
 */

// DOM Elements
const sessionLoading = document.getElementById('session-loading');
const sessionNotFound = document.getElementById('session-not-found');
const sessionContent = document.getElementById('session-content');
const playersList = document.getElementById('players-list');
const resultsModal = document.getElementById('results-modal');

// State
let sessionId = null;
let currentPlayerId = null;
let sessionData = null;
let pollInterval = null;

/**
 * Initialize the session page
 */
async function init() {
  // Get session ID from URL
  const urlParams = new URLSearchParams(window.location.search);
  sessionId = urlParams.get('id');

  if (!sessionId) {
    showNotFound();
    return;
  }

  // Get current player ID
  currentPlayerId = window.NeutroniumAuth?.getPlayerId() || localStorage.getItem('neutronium_guest_id');

  // Load session data
  await loadSession();

  // Set up event listeners
  setupEventListeners();

  // Start polling for updates
  startPolling();
}

/**
 * Set up event listeners
 */
function setupEventListeners() {
  document.getElementById('btn-submit-score')?.addEventListener('click', submitScore);
  document.getElementById('btn-end-game')?.addEventListener('click', voteEndGame);
}

/**
 * Load session data from API
 */
async function loadSession() {
  try {
    const response = await fetch(`/api/session/${sessionId}`);

    if (response.status === 404) {
      showNotFound();
      return;
    }

    if (!response.ok) {
      throw new Error('Failed to load session');
    }

    const apiData = await response.json();

    // Transform API response to expected format
    sessionData = transformApiResponse(apiData);
    renderSession();
  } catch (error) {
    console.error('Error loading session:', error);
    showNotFound();
  }
}

/**
 * Transform API response to internal format
 */
function transformApiResponse(apiData) {
  const { session, stats } = apiData;

  return {
    id: session.id,
    boxId: session.box_id,
    universeLevel: session.universe_level,
    status: session.status,
    hostPlayerId: session.host_player_id,
    startedAt: session.started_at,
    endedAt: session.ended_at,
    players: (session.players || []).map(sp => ({
      id: sp.player_id,
      sessionPlayerId: sp.id,
      name: sp.player?.display_name || 'Unknown',
      isGuest: sp.player?.is_guest ?? true,
      isHost: sp.player_id === session.host_player_id,
      race: sp.race,
      startingNn: sp.starting_nn,
      finalNn: sp.final_nn,
      votedEnd: sp.voted_end,
      joinedAt: sp.joined_at,
    })),
    endVotes: {
      current: stats?.playersVotedEnd || 0,
      required: stats?.totalPlayers || 0,
    },
    stats,
  };
}

/**
 * Render session data
 */
function renderSession() {
  if (!sessionData) return;

  // Hide loading, show content
  sessionLoading.classList.add('hidden');
  sessionContent.classList.remove('hidden');

  // Update header
  document.getElementById('session-level').textContent = sessionData.universeLevel;
  document.getElementById('session-box').textContent = sessionData.boxId;

  // Update status badge
  const statusBadge = document.getElementById('session-status');
  statusBadge.textContent = sessionData.status.charAt(0).toUpperCase() + sessionData.status.slice(1);
  statusBadge.className = `badge ${sessionData.status === 'active' ? 'badge-host' : 'badge-you'}`;

  // Render players
  renderPlayers();

  // Update end votes
  if (sessionData.endVotes) {
    document.getElementById('end-votes').textContent =
      `${sessionData.endVotes.current}/${sessionData.endVotes.required}`;
  }

  // Check if current player has voted
  const myPlayer = sessionData.players.find(p => p.id === currentPlayerId);
  if (myPlayer?.votedEnd) {
    const btn = document.getElementById('btn-end-game');
    btn.textContent = 'Vote Submitted';
    btn.disabled = true;
  }

  // Show results if session completed
  if (sessionData.status === 'completed') {
    showResults();
    stopPolling();
  }

  // Pre-fill score if available
  if (myPlayer) {
    if (myPlayer.race) {
      document.getElementById('my-race').value = myPlayer.race;
    }
    if (myPlayer.startingNn !== null && myPlayer.startingNn !== undefined) {
      document.getElementById('my-starting-nn').value = myPlayer.startingNn;
    }
    if (myPlayer.finalNn !== null && myPlayer.finalNn !== undefined) {
      document.getElementById('my-final-nn').value = myPlayer.finalNn;
    }
  }
}

/**
 * Render players list
 */
function renderPlayers() {
  if (!sessionData?.players) return;

  playersList.innerHTML = sessionData.players.map(player => {
    const isMe = player.id === currentPlayerId;
    const isHost = player.isHost;

    return `
      <div class="player-card">
        <div class="player-avatar">${player.name.charAt(0).toUpperCase()}</div>
        <div class="player-info">
          <div class="player-name">
            ${escapeHtml(player.name)}
            ${isHost ? '<span class="badge badge-host ml-sm">Host</span>' : ''}
            ${isMe ? '<span class="badge badge-you ml-sm">You</span>' : ''}
          </div>
          <div class="player-meta">
            ${player.race ? `<span>${player.race}</span> • ` : ''}
            ${player.finalNn !== null ? `<span class="nn-value">${player.finalNn}</span>` : 'No score yet'}
            ${player.votedEnd ? ' • Ready to end' : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Submit player score
 */
async function submitScore() {
  const race = document.getElementById('my-race').value || null;
  const startingNn = parseInt(document.getElementById('my-starting-nn').value) || 0;
  const finalNn = parseInt(document.getElementById('my-final-nn').value);

  if (isNaN(finalNn) || finalNn < 0) {
    alert('Please enter a valid final Nn score');
    return;
  }

  try {
    const response = await fetch('/api/session/submit-score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        playerId: currentPlayerId,
        race,
        startingNn,
        finalNn,
      }),
      credentials: 'include',
    });

    const data = await response.json();

    if (response.ok) {
      // Refresh session data
      await loadSession();
    } else {
      alert(data.error || 'Failed to submit score');
    }
  } catch (error) {
    console.error('Error submitting score:', error);
    alert('Network error. Please try again.');
  }
}

/**
 * Vote to end the game
 */
async function voteEndGame() {
  // Check if player has submitted a score
  const myPlayer = sessionData?.players.find(p => p.id === currentPlayerId);
  if (!myPlayer || myPlayer.finalNn === null || myPlayer.finalNn === undefined) {
    alert('Please submit your score before ending the game');
    return;
  }

  try {
    const response = await fetch('/api/session/end', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        playerId: currentPlayerId,
      }),
      credentials: 'include',
    });

    const data = await response.json();

    if (response.ok) {
      // Update button state
      const btn = document.getElementById('btn-end-game');
      btn.textContent = 'Vote Submitted';
      btn.disabled = true;

      // Check if session is now completed
      if (data.sessionCompleted) {
        sessionData.status = 'completed';
        showResults();
        stopPolling();
      } else {
        // Update vote count
        document.getElementById('end-votes').textContent =
          `${data.votedCount}/${data.totalPlayers}`;
      }
    } else {
      alert(data.error || 'Failed to submit vote');
    }
  } catch (error) {
    console.error('Error voting to end:', error);
    alert('Network error. Please try again.');
  }
}

/**
 * Show results modal
 */
function showResults() {
  const content = document.getElementById('results-content');
  const results = sessionData.results || sessionData.players.filter(p => p.finalNn !== null);

  // Sort by final Nn descending
  const sortedResults = [...results].sort((a, b) => (b.finalNn || 0) - (a.finalNn || 0));

  content.innerHTML = `
    <div class="mb-lg">
      ${sortedResults.map((player, index) => `
        <div class="player-card">
          <div style="font-family: var(--font-display); font-weight: 700; font-size: 1.5rem; width: 40px; color: ${index === 0 ? 'var(--color-nn)' : 'var(--color-text-muted)'};">
            #${index + 1}
          </div>
          <div class="player-info">
            <div class="player-name">
              ${escapeHtml(player.name || player.displayName)}
              ${player.newBest ? '<span class="badge badge-new-best ml-sm">New Best!</span>' : ''}
            </div>
            <div class="player-meta">
              ${player.race ? `${player.race} • ` : ''}
              <span class="nn-value">${player.finalNn}</span>
            </div>
          </div>
        </div>
      `).join('')}
    </div>

    <div id="save-progress-prompt" class="card">
      <p class="mb-md">Want to save your progress to the leaderboard?</p>
      <input type="email" id="save-email" class="form-input mb-md" placeholder="your@email.com">
      <button type="button" id="btn-save-progress" class="btn btn-primary" style="width: 100%;">
        Save Progress
      </button>
    </div>
  `;

  // Set up save progress handler
  document.getElementById('btn-save-progress')?.addEventListener('click', async () => {
    const email = document.getElementById('save-email').value.trim();
    if (!email) {
      alert('Please enter your email');
      return;
    }

    try {
      const result = await window.NeutroniumAuth?.sendMagicLink(email, currentPlayerId);
      if (result?.success) {
        document.getElementById('save-progress-prompt').innerHTML = `
          <div class="alert alert-success">
            Check your email! Click the link to save your progress.
          </div>
        `;
      } else {
        alert(result?.error || 'Failed to send email');
      }
    } catch (error) {
      alert('Network error. Please try again.');
    }
  });

  resultsModal.classList.add('active');
}

/**
 * Show not found state
 */
function showNotFound() {
  sessionLoading.classList.add('hidden');
  sessionNotFound.classList.remove('hidden');
  stopPolling();
}

/**
 * Start polling for session updates
 */
function startPolling() {
  // Poll every 5 seconds
  pollInterval = setInterval(async () => {
    if (sessionData?.status === 'completed') {
      stopPolling();
      return;
    }
    await loadSession();
  }, 5000);
}

/**
 * Stop polling
 */
function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

/**
 * Escape HTML to prevent XSS
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Clean up on page unload
window.addEventListener('beforeunload', stopPolling);

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', init);