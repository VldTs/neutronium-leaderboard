/**
 * Main app logic for Neutronium Leaderboard
 * Handles landing page and box entry flow
 */

// DOM Elements
const boxIdInput = document.getElementById('box-id');
const btnCheckBox = document.getElementById('btn-check-box');
const boxLoading = document.getElementById('box-loading');
const boxForm = document.getElementById('box-form');
const boxNotFound = document.getElementById('box-not-found');
const boxFound = document.getElementById('box-found');
const boxError = document.getElementById('box-error');

// State
let currentBoxId = null;
let activeSession = null;

/**
 * Initialize the app
 */
async function init() {
  // Check for box ID in URL params
  const urlParams = new URLSearchParams(window.location.search);
  const boxParam = urlParams.get('box');

  if (boxParam) {
    boxIdInput.value = boxParam;
    await checkBox(boxParam);
  }

  // Pre-fill player name if stored
  const storedName = window.NeutroniumAuth?.getStoredPlayerName();
  if (storedName) {
    const playerNameInput = document.getElementById('player-name');
    const joinPlayerNameInput = document.getElementById('join-player-name');
    if (playerNameInput) playerNameInput.value = storedName;
    if (joinPlayerNameInput) joinPlayerNameInput.value = storedName;
  }

  // Load leaderboard preview
  loadLeaderboardPreview();

  // Set up event listeners
  setupEventListeners();
}

/**
 * Set up event listeners
 */
function setupEventListeners() {
  btnCheckBox.addEventListener('click', () => checkBox(boxIdInput.value));

  boxIdInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') checkBox(boxIdInput.value);
  });

  document.getElementById('btn-register-box')?.addEventListener('click', registerBox);
  document.getElementById('btn-start-session')?.addEventListener('click', startSession);
  document.getElementById('btn-join-session')?.addEventListener('click', joinSession);
  document.getElementById('btn-retry')?.addEventListener('click', resetForm);
}

/**
 * Check if a box exists and get its status
 * @param {string} boxId - Box ID to check
 */
async function checkBox(boxId) {
  boxId = boxId.trim().toUpperCase();

  if (!boxId) {
    showError('Please enter a box ID');
    return;
  }

  // Basic format validation
  if (!/^NE-\d{4}-\d{5}$/.test(boxId)) {
    showError('Invalid box ID format. Expected: NE-YYYY-XXXXX');
    return;
  }

  currentBoxId = boxId;
  showLoading(true);
  hideAllSections();

  try {
    const response = await fetch(`/api/box/${boxId}`);
    const data = await response.json();

    if (response.status === 404) {
      // Box not found - show registration
      showSection(boxNotFound);
    } else if (response.ok) {
      // Box found
      showBoxFound(data);
    } else {
      showError(data.error || 'Failed to check box');
    }
  } catch (error) {
    console.error('Error checking box:', error);
    showError('Network error. Please try again.');
  } finally {
    showLoading(false);
  }
}

/**
 * Register a new box
 */
async function registerBox() {
  const email = document.getElementById('register-email')?.value.trim();

  showLoading(true);

  try {
    const response = await fetch(`/api/box/${currentBoxId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email || undefined }),
    });

    const data = await response.json();

    if (response.ok) {
      // Box registered, now show start session
      showBoxFound({ boxId: currentBoxId, registered: true, activeSession: null });
    } else {
      showError(data.error || 'Failed to register box');
    }
  } catch (error) {
    console.error('Error registering box:', error);
    showError('Network error. Please try again.');
  } finally {
    showLoading(false);
  }
}

/**
 * Show box found state
 * @param {Object} data - Box data
 */
function showBoxFound(data) {
  showSection(boxFound);

  const statusText = document.getElementById('box-status-text');
  const startSession = document.getElementById('start-session');
  const joinSession = document.getElementById('join-session');

  if (data.activeSession) {
    // Active session exists
    activeSession = data.activeSession;
    statusText.textContent = 'An active session is in progress.';
    startSession.classList.add('hidden');
    joinSession.classList.remove('hidden');

    document.getElementById('active-level').textContent = data.activeSession.universeLevel;
    document.getElementById('active-players').textContent = data.activeSession.playerCount;
  } else {
    // No active session
    activeSession = null;
    statusText.textContent = 'Ready to start a new game.';
    startSession.classList.remove('hidden');
    joinSession.classList.add('hidden');
  }
}

/**
 * Start a new session
 */
async function startSession() {
  const playerName = document.getElementById('player-name')?.value.trim();
  const universeLevel = parseInt(document.getElementById('universe-level')?.value || '1');

  if (!playerName) {
    alert('Please enter your name');
    return;
  }

  // Store player name
  window.NeutroniumAuth?.setStoredPlayerName(playerName);

  showLoading(true);

  try {
    const response = await fetch('/api/session/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        boxId: currentBoxId,
        universeLevel,
        playerName,
        playerId: window.NeutroniumAuth?.getOrCreateGuestId(),
      }),
      credentials: 'include',
    });

    const data = await response.json();

    if (response.ok) {
      // Redirect to session page
      window.location.href = `/session.html?id=${data.session.id}`;
    } else if (response.status === 409) {
      // Active session already exists
      showError(data.error);
      if (data.sessionId) {
        activeSession = { id: data.sessionId };
        setTimeout(() => checkBox(currentBoxId), 1000);
      }
    } else {
      showError(data.error || 'Failed to create session');
    }
  } catch (error) {
    console.error('Error creating session:', error);
    showError('Network error. Please try again.');
  } finally {
    showLoading(false);
  }
}

/**
 * Join an existing session
 */
async function joinSession() {
  const playerName = document.getElementById('join-player-name')?.value.trim();

  if (!playerName) {
    alert('Please enter your name');
    return;
  }

  if (!activeSession?.id) {
    showError('No active session to join');
    return;
  }

  // Store player name
  window.NeutroniumAuth?.setStoredPlayerName(playerName);

  showLoading(true);

  try {
    const response = await fetch('/api/session/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: activeSession.id,
        playerName,
        playerId: window.NeutroniumAuth?.getOrCreateGuestId(),
      }),
      credentials: 'include',
    });

    const data = await response.json();

    if (response.ok) {
      // Redirect to session page
      window.location.href = `/session.html?id=${data.session.id}`;
    } else {
      showError(data.error || 'Failed to join session');
    }
  } catch (error) {
    console.error('Error joining session:', error);
    showError('Network error. Please try again.');
  } finally {
    showLoading(false);
  }
}

/**
 * Load leaderboard preview (top 5 players)
 */
async function loadLeaderboardPreview() {
  const container = document.getElementById('leaderboard-preview');
  if (!container) return;

  try {
    const response = await fetch('/api/leaderboard/global?limit=5');

    if (!response.ok) {
      container.innerHTML = '<p class="text-muted text-center">Unable to load leaderboard</p>';
      return;
    }

    const data = await response.json();

    if (!data.rankings || data.rankings.length === 0) {
      container.innerHTML = '<p class="text-muted text-center">No players yet. Be the first!</p>';
      return;
    }

    container.innerHTML = `
      <table class="rankings-table">
        <thead>
          <tr>
            <th>Rank</th>
            <th>Player</th>
            <th>Total Nn</th>
          </tr>
        </thead>
        <tbody>
          ${data.rankings.map(player => `
            <tr>
              <td class="rank-cell ${player.rank <= 3 ? `rank-${player.rank}` : ''}">#${player.rank}</td>
              <td>${escapeHtml(player.name)}</td>
              <td class="nn-value">${player.totalBestNn}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (error) {
    console.error('Error loading leaderboard preview:', error);
    container.innerHTML = '<p class="text-muted text-center">Unable to load leaderboard</p>';
  }
}

/**
 * Show loading state
 * @param {boolean} show - Whether to show loading
 */
function showLoading(show) {
  boxLoading.classList.toggle('hidden', !show);
  boxForm.classList.toggle('hidden', show);
}

/**
 * Hide all result sections
 */
function hideAllSections() {
  boxNotFound.classList.add('hidden');
  boxFound.classList.add('hidden');
  boxError.classList.add('hidden');
}

/**
 * Show a specific section
 * @param {HTMLElement} section - Section to show
 */
function showSection(section) {
  hideAllSections();
  section.classList.remove('hidden');
}

/**
 * Show error message
 * @param {string} message - Error message
 */
function showError(message) {
  showSection(boxError);
  document.getElementById('error-message').textContent = message;
}

/**
 * Reset form to initial state
 */
function resetForm() {
  hideAllSections();
  boxIdInput.value = '';
  currentBoxId = null;
  activeSession = null;
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

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', init);