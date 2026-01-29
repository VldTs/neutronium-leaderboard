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
const signinModal = document.getElementById('signin-modal');

// State
let sessionId = null;
let currentPlayerId = null;
let sessionData = null;
let pollInterval = null;
let isGuest = true;
let previousSessionLevel = null;
let referenceScores = null;

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

  // Check if returning from sign-in (either via signed_in or auth_success param)
  const returnFromSignIn = urlParams.get('signed_in') === '1' || urlParams.get('auth_success') === '1';
  if (returnFromSignIn) {
    // Clean URL
    const cleanUrl = new URL(window.location);
    cleanUrl.searchParams.delete('signed_in');
    cleanUrl.searchParams.delete('auth_success');
    window.history.replaceState({}, '', cleanUrl);
  }

  // Get the OLD player ID from localStorage BEFORE checking authenticated user
  // This is the ID that was used when the player was a guest
  const oldPlayerId = window.NeutroniumAuth?.getPlayerId() || localStorage.getItem('neutronium_guest_id');

  // Get current user status (this might be different from oldPlayerId if user signed in with existing account)
  const currentUser = await window.NeutroniumAuth?.getCurrentUser();
  isGuest = !currentUser;

  // Set current player ID - use authenticated user ID if available
  currentPlayerId = currentUser?.id || oldPlayerId;

  // If returning from sign-in, rejoin session with authenticated player and recalculate level
  if (returnFromSignIn && currentUser) {
    console.log('Returning from sign-in:', {
      authenticatedPlayerId: currentUser.id,
      oldPlayerId,
      playerName: currentUser.displayName,
    });
    await rejoinSessionAsAuthenticatedPlayer(currentUser, oldPlayerId);
  }

  // Load session data
  await loadSession();

  // Show guest sign-in banner if applicable
  updateGuestBanner();

  // Set up event listeners
  setupEventListeners();

  // Start polling for updates
  startPolling();
}

/**
 * Update guest sign-in banner visibility
 */
function updateGuestBanner() {
  const banner = document.getElementById('guest-signin-banner');
  if (banner) {
    banner.classList.toggle('hidden', !isGuest);
  }
}

/**
 * Rejoin session as authenticated player after sign-in
 * This adds the authenticated player to the session and recalculates the level
 */
async function rejoinSessionAsAuthenticatedPlayer(currentUser, oldPlayerId) {
  try {
    // Use the authenticated user's name from database, fallback to stored name
    const playerName = currentUser.displayName || window.NeutroniumAuth?.getStoredPlayerName() || 'Player';
    const playerColor = localStorage.getItem('neutronium_player_color') || null;

    console.log('Rejoining session with authenticated player:', {
      sessionId,
      playerId: currentUser.id,
      oldPlayerId,
      playerName,
    });

    // Join the session with the authenticated player ID
    // Pass the old player ID so the server can remove the old guest entry
    const response = await fetch('/api/session/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        playerName,
        playerColor,
        playerId: currentUser.id,
        replacePlayerId: oldPlayerId !== currentUser.id ? oldPlayerId : undefined,
      }),
      credentials: 'include',
    });

    if (response.ok) {
      const data = await response.json();

      // Update the stored player ID
      window.NeutroniumAuth?.setPlayerId(currentUser.id);

      // Check if level changed
      if (data.levelChanged) {
        showLevelChangedBanner(data.previousLevel, data.newLevel);
      }

      // Update guest banner visibility
      isGuest = false;
      updateGuestBanner();

      console.log('Rejoined session successfully:', data);
    } else {
      const errorData = await response.json();
      console.error('Failed to rejoin session:', errorData);
    }
  } catch (error) {
    console.error('Error rejoining session as authenticated player:', error);
  }
}

/**
 * Recalculate session level after sign-in
 */
async function recalculateSessionLevel() {
  try {
    const response = await fetch('/api/session/recalculate-level', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        playerId: currentPlayerId,
      }),
      credentials: 'include',
    });

    if (response.ok) {
      const data = await response.json();
      if (data.levelChanged) {
        // Show level changed banner
        showLevelChangedBanner(data.previousLevel, data.newLevel);
      }
    }
  } catch (error) {
    console.error('Error recalculating session level:', error);
  }
}

/**
 * Show the level changed banner
 */
function showLevelChangedBanner(previousLevel, newLevel) {
  const banner = document.getElementById('level-changed-banner');
  const message = document.getElementById('level-changed-message');

  if (banner && message) {
    if (newLevel < previousLevel) {
      message.textContent = `The session level was adjusted from Level ${previousLevel} to Level ${newLevel} to match all players' progress.`;
    } else {
      message.textContent = `The session level was updated to Level ${newLevel}.`;
    }
    banner.classList.remove('hidden');

    // Auto-hide after 10 seconds
    setTimeout(() => {
      banner.classList.add('hidden');
    }, 10000);
  }
}

/**
 * Set up event listeners
 */
function setupEventListeners() {
  document.getElementById('btn-submit-score')?.addEventListener('click', submitScore);
  document.getElementById('btn-end-game')?.addEventListener('click', voteEndGame);

  // Sign-in modal
  document.getElementById('btn-session-signin')?.addEventListener('click', showSignInModal);
  document.getElementById('btn-cancel-signin')?.addEventListener('click', hideSignInModal);
  document.getElementById('btn-send-signin-link')?.addEventListener('click', sendSignInLink);

  // Close modal on background click
  signinModal?.addEventListener('click', (e) => {
    if (e.target === signinModal) {
      hideSignInModal();
    }
  });
}

/**
 * Show sign-in modal
 */
function showSignInModal() {
  signinModal?.classList.add('active');
  document.getElementById('signin-email')?.focus();
}

/**
 * Hide sign-in modal
 */
function hideSignInModal() {
  signinModal?.classList.remove('active');
  document.getElementById('signin-email').value = '';
  document.getElementById('signin-success')?.classList.add('hidden');
}

/**
 * Send sign-in magic link
 */
async function sendSignInLink() {
  const emailInput = document.getElementById('signin-email');
  const email = emailInput?.value.trim();

  if (!email) {
    alert('Please enter your email');
    return;
  }

  if (!email.includes('@') || !email.includes('.')) {
    alert('Please enter a valid email address');
    return;
  }

  const btn = document.getElementById('btn-send-signin-link');
  btn.disabled = true;
  btn.textContent = 'Sending...';

  try {
    // Include the return URL with session ID and signed_in flag
    const returnUrl = `${window.location.origin}/session.html?id=${sessionId}&signed_in=1`;

    const result = await window.NeutroniumAuth?.sendMagicLink(email, currentPlayerId, returnUrl);

    if (result?.success) {
      // Show success message
      document.getElementById('signin-success')?.classList.remove('hidden');
      btn.textContent = 'Link Sent!';

      // Hide input
      emailInput.closest('.form-group')?.classList.add('hidden');
    } else {
      btn.disabled = false;
      btn.textContent = 'Send Magic Link';
      alert(result?.error || 'Failed to send magic link');
    }
  } catch (error) {
    console.error('Error sending magic link:', error);
    btn.disabled = false;
    btn.textContent = 'Send Magic Link';
    alert('Network error. Please try again.');
  }
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
    const url = currentPlayerId
      ? `/api/session/${sessionId}?playerId=${encodeURIComponent(currentPlayerId)}`
      : `/api/session/${sessionId}`;
    const response = await fetch(url);

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

    // Capture reference scores if returned
    if (apiData.referenceScores) {
      referenceScores = apiData.referenceScores;
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

  const newData = {
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

  // Check if level changed (during polling)
  if (sessionData && sessionData.universeLevel !== newData.universeLevel) {
    showLevelChangedBanner(sessionData.universeLevel, newData.universeLevel);
  }

  return newData;
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

  // Update player count
  const playerCountEl = document.getElementById('session-player-count');
  if (playerCountEl) {
    playerCountEl.textContent = `${sessionData.players.length} player${sessionData.players.length !== 1 ? 's' : ''}`;
  }

  // Render players
  renderPlayers();

  // Calculate submission progress
  const submittedCount = sessionData.players.filter(p => p.finalNn !== null).length;
  const totalPlayers = sessionData.players.length;
  renderSubmissionProgress(submittedCount, totalPlayers);

  // Update end votes (hidden span for compatibility)
  if (sessionData.endVotes) {
    document.getElementById('end-votes').textContent =
      `${sessionData.endVotes.current}/${sessionData.endVotes.required}`;
  }

  // Render vote dots
  renderVoteDots();

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

  // Render reference scores
  renderReferenceScores();

  // Pre-fill score if available
  if (myPlayer) {
    if (myPlayer.color) {
      showMyColor(myPlayer.color);
    }
    const hasPrevBest = referenceScores?.previousLevelBest != null && referenceScores.previousLevelBest > 0;
    const hasExplicitStarting = myPlayer.startingNn != null && myPlayer.startingNn > 0;
    const startingValue = hasExplicitStarting ? myPlayer.startingNn : (hasPrevBest ? referenceScores.previousLevelBest : 0);
    setStartingNnDisplay(startingValue);
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
 * Render players list (v2 with color bars)
 */
function renderPlayers() {
  if (!sessionData?.players) return;

  playersList.innerHTML = sessionData.players.map(player => {
    const isMe = player.id === currentPlayerId;
    const isHost = player.isHost;
    const barColor = player.color ? getColorHex(player.color) : 'var(--color-accent)';
    const hasScore = player.finalNn !== null;

    const statusIcons = [];
    if (hasScore) {
      statusIcons.push('<div class="status-icon status-icon-scored">&#10003;</div>');
    }
    if (player.votedEnd) {
      statusIcons.push('<div class="status-icon status-icon-voted">&#9632;</div>');
    }

    return `
      <div class="player-card-v2 ${isMe ? 'player-card-me' : ''}">
        <div class="player-color-bar" style="background: ${barColor};"></div>
        <div class="player-info">
          <div class="player-name">
            ${escapeHtml(player.name)}
            ${isMe ? '<span class="badge badge-you ml-sm">You</span>' : ''}
            ${isHost ? '<span class="badge badge-host ml-sm">Host</span>' : ''}
          </div>
          <div class="player-meta">
            ${hasScore ? `<span class="nn-value">${player.finalNn}</span>` : '<span style="font-style: italic;">Waiting for score...</span>'}
          </div>
        </div>
        ${statusIcons.length ? `<div class="player-status-icons">${statusIcons.join('')}</div>` : ''}
      </div>
    `;
  }).join('');
}

/**
 * Set starting Nn read-only display
 */
function setStartingNnDisplay(value) {
  const el = document.getElementById('my-starting-nn');
  if (!el) return;
  el.dataset.value = value;
  const span = el.querySelector('.score-display-value');
  if (span) {
    span.textContent = value > 0 ? value : '—';
    span.classList.toggle('has-value', value > 0);
  }
}

/**
 * Render reference scores bar (only "Your best at this level")
 * Previous-level best is shown as a hint on the Starting Nn input instead.
 */
function renderReferenceScores() {
  const container = document.getElementById('reference-scores');
  if (!container) return;

  if (referenceScores?.currentLevelBest !== null && referenceScores?.currentLevelBest !== undefined) {
    container.innerHTML = `<span class="reference-score-item">Your best at this level: <span class="nn-value">${referenceScores.currentLevelBest}</span></span>`;
    container.classList.remove('hidden');
  } else {
    container.classList.add('hidden');
  }

  // Show hint on Starting Nn when auto-filled from previous level
  const hint = document.getElementById('starting-nn-hint');
  if (hint && referenceScores?.previousLevelBest !== null && referenceScores?.previousLevelBest !== undefined) {
    const prevLevel = (sessionData?.universeLevel || 1) - 1;
    hint.textContent = `from Level ${prevLevel}`;
    hint.classList.remove('hidden');
  }
}

/**
 * Render vote dots for end game section
 */
function renderVoteDots() {
  const container = document.getElementById('vote-dots');
  if (!container || !sessionData?.players) return;

  container.innerHTML = sessionData.players.map(player => {
    const initial = player.name.charAt(0).toUpperCase();
    const voted = player.votedEnd;
    const borderColor = player.color ? getColorHex(player.color) : 'var(--color-border)';

    return `<div class="vote-dot ${voted ? 'vote-dot-voted' : ''}" style="border-color: ${voted ? '' : borderColor};" title="${escapeHtml(player.name)}${voted ? ' (voted)' : ''}">${voted ? '&#10003;' : initial}</div>`;
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
  const startingNn = parseInt(document.getElementById('my-starting-nn').dataset.value) || 0;
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
        // Update vote count and re-render dots
        document.getElementById('end-votes').textContent =
          `${data.votedCount}/${data.totalPlayers}`;
        // Refresh session to get updated vote states
        await loadSession();
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

/**
 * Calculate and apply padding for sticky score input on mobile
 */
function setupStickyPadding() {
  const scoreInput = document.getElementById('score-input');
  if (!scoreInput || window.innerWidth >= 769) return;

  const updatePadding = () => {
    const height = scoreInput.offsetHeight;
    document.body.style.setProperty('--session-sticky-height', `${height}px`);
  };

  updatePadding();
  window.addEventListener('resize', updatePadding);

  // Re-calc after score section visibility changes
  const observer = new MutationObserver(updatePadding);
  observer.observe(scoreInput, { attributes: true, attributeFilter: ['class'] });
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  init();
  setupHeaderScroll();
  setupStickyPadding();
});