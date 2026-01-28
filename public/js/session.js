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
 * Show player's color in the score section
 */
function showMyColor(color) {
  const indicator = document.getElementById('my-color-indicator');
  if (indicator && color) {
    indicator.style.background = getColorHex(color);
    document.getElementById('my-color').value = color;
  }
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

    // Check if session is completed and there's a next session
    // This handles when another player submitted the last score
    if (apiData.session?.status === 'completed' && apiData.nextSession) {
      stopPolling();
      showNextLevelTransition(apiData.nextSession);
      return;
    }

    // Check if all 13 levels completed
    if (apiData.session?.status === 'completed' && !apiData.nextSession && apiData.session?.universe_level === 13) {
      stopPolling();
      showGameComplete();
      return;
    }

    // Transform API response to expected format
    sessionData = transformApiResponse(apiData);

    // Store active session for rejoin capability (if session is active)
    if (sessionData.status === 'active') {
      window.NeutroniumAuth?.setActiveSession({
        id: sessionData.id,
        box_id: sessionData.boxId,
        universe_level: sessionData.universeLevel,
      });
    }

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
      color: sp.race, // race field stores color
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

  // Calculate submission progress
  const submittedCount = sessionData.players.filter(p => p.finalNn !== null).length;
  const totalPlayers = sessionData.players.length;
  renderSubmissionProgress(submittedCount, totalPlayers);

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
    if (myPlayer.color) {
      showMyColor(myPlayer.color);
    }
    if (myPlayer.startingNn !== null && myPlayer.startingNn !== undefined) {
      document.getElementById('my-starting-nn').value = myPlayer.startingNn;
    }
    if (myPlayer.finalNn !== null && myPlayer.finalNn !== undefined) {
      document.getElementById('my-final-nn').value = myPlayer.finalNn;
      // Show submitted message and update button
      document.getElementById('score-submitted-msg')?.classList.remove('hidden');
      const btn = document.getElementById('btn-submit-score');
      if (btn) {
        btn.textContent = 'Update Score';
        btn.disabled = false;
      }
    }
  }

  // Hide score input if not in session
  const scoreInput = document.getElementById('score-input');
  if (scoreInput) {
    scoreInput.classList.toggle('hidden', !myPlayer);
  }
}

/**
 * Render submission progress bar
 */
function renderSubmissionProgress(submitted, total) {
  let progressContainer = document.getElementById('submission-progress');

  // Create container if it doesn't exist
  if (!progressContainer) {
    const playersSection = playersList?.parentElement;
    if (playersSection) {
      progressContainer = document.createElement('div');
      progressContainer.id = 'submission-progress';
      progressContainer.className = 'submission-progress';
      playersSection.insertBefore(progressContainer, playersList);
    }
  }

  if (progressContainer) {
    const percentage = total > 0 ? (submitted / total) * 100 : 0;
    const allSubmitted = submitted === total && total > 0;

    progressContainer.innerHTML = `
      <div class="submission-progress-bar">
        <div class="submission-progress-fill" style="width: ${percentage}%;"></div>
      </div>
      <span class="submission-progress-text ${allSubmitted ? 'text-success' : ''}">
        ${submitted}/${total} ${allSubmitted ? '&#10003;' : ''}
      </span>
    `;
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
    const avatarColor = player.color ? getColorHex(player.color) : 'var(--color-accent)';
    const hasScore = player.finalNn !== null;

    return `
      <div class="player-card ${isMe ? 'player-card-me' : ''}">
        <div class="player-avatar" style="background: ${avatarColor};">
          ${player.name.charAt(0).toUpperCase()}
        </div>
        <div class="player-info">
          <div class="player-name">
            ${escapeHtml(player.name)}
            ${isMe ? '<span class="badge badge-you ml-sm">You</span>' : ''}
            ${isHost ? '<span class="badge badge-host ml-sm">Host</span>' : ''}
          </div>
          <div class="player-meta">
            ${hasScore ? `<span class="nn-value">${player.finalNn}</span>` : '<span class="text-muted">Waiting for score...</span>'}
            ${player.votedEnd ? '<span class="player-status-ready">Ready</span>' : ''}
          </div>
        </div>
        ${hasScore ? '<div class="player-check">&#10003;</div>' : ''}
      </div>
    `;
  }).join('');
}

/**
 * Get hex color from color name
 */
function getColorHex(color) {
  const colors = {
    gray: '#6b7280',
    pink: '#ec4899',
    purple: '#8b5cf6',
    green: '#22c55e',
  };
  return colors[color] || colors.gray;
}

/**
 * Submit player score
 */
async function submitScore() {
  const color = document.getElementById('my-color').value || null;
  const startingNn = parseInt(document.getElementById('my-starting-nn').value) || 0;
  const finalNn = parseInt(document.getElementById('my-final-nn').value);

  if (isNaN(finalNn) || finalNn < 0) {
    alert('Please enter a valid final Nn score');
    return;
  }

  const btn = document.getElementById('btn-submit-score');
  btn.disabled = true;
  btn.textContent = 'Submitting...';

  try {
    const response = await fetch('/api/session/submit-score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        playerId: currentPlayerId,
        color,
        startingNn,
        finalNn,
      }),
      credentials: 'include',
    });

    const data = await response.json();

    if (response.ok) {
      // Show submitted message
      document.getElementById('score-submitted-msg')?.classList.remove('hidden');
      btn.textContent = 'Score Submitted';

      // Check if all players submitted and we're moving to next level
      if (data.allSubmitted && data.nextSession) {
        // Stop polling and show transition message
        stopPolling();
        showNextLevelTransition(data.nextSession);
      } else if (data.allSubmitted && !data.nextSession) {
        // All 13 levels completed!
        stopPolling();
        showGameComplete();
      } else {
        // Update submission progress
        updateSubmissionProgress(data.submittedCount, data.totalPlayers);
        // Refresh session data
        await loadSession();
      }
    } else {
      btn.disabled = false;
      btn.textContent = 'Submit Score';
      alert(data.error || 'Failed to submit score');
    }
  } catch (error) {
    console.error('Error submitting score:', error);
    btn.disabled = false;
    btn.textContent = 'Submit Score';
    alert('Network error. Please try again.');
  }
}

/**
 * Update submission progress display
 */
function updateSubmissionProgress(submitted, total) {
  const msg = document.getElementById('score-submitted-msg');
  if (msg) {
    msg.textContent = `Score submitted! Waiting for other players (${submitted}/${total})`;
    msg.classList.remove('hidden');
  }
}

/**
 * Show transition to next level
 */
function showNextLevelTransition(nextSession) {
  const currentLevel = sessionData?.universeLevel || (nextSession.universeLevel - 1);
  const currentBoxId = sessionData?.boxId || null;

  // Store the new session
  window.NeutroniumAuth?.setActiveSession({
    id: nextSession.id,
    box_id: currentBoxId,
    universe_level: nextSession.universeLevel,
  });

  // Show transition modal
  const modal = document.getElementById('results-modal');
  const content = document.getElementById('results-content');

  content.innerHTML = `
    <div class="text-center">
      <div class="next-level-icon">&#127881;</div>
      <h2 class="mb-md">Level ${currentLevel} Complete!</h2>
      <p class="text-muted mb-lg">All players submitted their scores. Moving to the next level...</p>
      <div class="next-level-info">
        <span class="next-level-badge">Next: Level ${nextSession.universeLevel}</span>
      </div>
      <p class="text-muted mt-lg">Redirecting in <span id="countdown">3</span> seconds...</p>
    </div>
  `;

  modal.classList.add('active');

  // Countdown and redirect
  let countdown = 3;
  const countdownEl = document.getElementById('countdown');
  const interval = setInterval(() => {
    countdown--;
    if (countdownEl) countdownEl.textContent = countdown;
    if (countdown <= 0) {
      clearInterval(interval);
      window.location.href = `/session.html?id=${nextSession.id}`;
    }
  }, 1000);
}

/**
 * Show game complete (all 13 levels done)
 */
function showGameComplete() {
  window.NeutroniumAuth?.clearActiveSession();

  const modal = document.getElementById('results-modal');
  const content = document.getElementById('results-content');

  content.innerHTML = `
    <div class="text-center">
      <div class="next-level-icon">&#127942;</div>
      <h2 class="mb-md">Congratulations!</h2>
      <p class="text-muted mb-lg">You've completed all 13 universe levels!</p>
    </div>

    <div id="save-progress-prompt" class="card mt-lg">
      <p class="mb-md">Save your progress to the leaderboard!</p>
      <input type="email" id="save-email" class="form-input mb-md" placeholder="your@email.com">
      <button type="button" id="btn-save-progress" class="btn btn-primary" style="width: 100%;">
        Save Progress
      </button>
    </div>
  `;

  // Update modal buttons
  const modalButtons = modal.querySelector('.mt-lg:last-child');
  if (modalButtons && !modalButtons.id) {
    modalButtons.innerHTML = `
      <a href="/leaderboard.html" class="btn btn-primary" style="flex: 1;">View Leaderboard</a>
      <a href="/" class="btn btn-secondary" style="flex: 1;">Home</a>
    `;
  }

  // Set up save progress handler
  setupSaveProgressHandler();

  modal.classList.add('active');
}

/**
 * Set up save progress button handler
 */
function setupSaveProgressHandler() {
  document.getElementById('btn-save-progress')?.addEventListener('click', async () => {
    const email = document.getElementById('save-email').value.trim();
    if (!email) {
      alert('Please enter your email');
      return;
    }

    // Basic email validation
    if (!email.includes('@') || !email.includes('.')) {
      alert('Please enter a valid email address');
      return;
    }

    const btn = document.getElementById('btn-save-progress');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
      const result = await window.NeutroniumAuth?.sendMagicLink(email, currentPlayerId);
      if (result?.success) {
        // Update player ID if returned
        if (result.playerId) {
          window.NeutroniumAuth?.setPlayerId(result.playerId);
        }
        document.getElementById('save-progress-prompt').innerHTML = `
          <div class="alert alert-success">
            <span class="alert-icon">&#10003;</span>
            <div>
              <strong>Progress Saved!</strong>
              <p>${result.message || 'Your scores have been saved to the leaderboard.'}</p>
              <p style="margin-top: 0.5rem; font-size: 0.875rem;">Email: <strong>${escapeHtml(email)}</strong></p>
            </div>
          </div>
        `;
      } else {
        btn.disabled = false;
        btn.textContent = 'Save Progress';
        alert(result?.error || 'Failed to save progress');
      }
    } catch (error) {
      console.error('Save progress error:', error);
      btn.disabled = false;
      btn.textContent = 'Save Progress';
      alert('Network error. Please try again.');
    }
  });
}

/**
 * Vote to end the game
 */
async function voteEndGame() {
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
  // Clear active session since game is over
  window.NeutroniumAuth?.clearActiveSession();

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
  setupSaveProgressHandler();

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

/**
 * Set up header hide-on-scroll behavior
 */
function setupHeaderScroll() {
  const header = document.querySelector('.header');
  if (!header) return;

  let lastScrollY = window.scrollY;
  let ticking = false;
  const scrollThreshold = 50;

  function updateHeader() {
    const currentScrollY = window.scrollY;

    if (currentScrollY > scrollThreshold) {
      if (currentScrollY > lastScrollY) {
        header.classList.add('header-hidden');
      } else {
        header.classList.remove('header-hidden');
      }
    } else {
      header.classList.remove('header-hidden');
    }

    lastScrollY = currentScrollY;
    ticking = false;
  }

  window.addEventListener('scroll', () => {
    if (!ticking) {
      window.requestAnimationFrame(updateHeader);
      ticking = true;
    }
  }, { passive: true });
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  init();
  setupHeaderScroll();
});