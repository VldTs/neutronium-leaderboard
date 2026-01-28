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
  // Check for active session first
  await checkActiveSession();

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
 * Check if player has an active session and show banner
 */
async function checkActiveSession() {
  const storedSession = window.NeutroniumAuth?.getActiveSession();
  if (!storedSession?.id) return;

  try {
    // Verify session is still active
    const response = await fetch(`/api/session/${storedSession.id}`);
    if (!response.ok) {
      // Session no longer exists or ended
      window.NeutroniumAuth?.clearActiveSession();
      return;
    }

    const data = await response.json();
    if (data.session?.status !== 'active') {
      // Session ended
      window.NeutroniumAuth?.clearActiveSession();
      return;
    }

    // Session is still active - show banner
    showActiveSessionBanner(storedSession, data.session);
  } catch (error) {
    console.error('Error checking active session:', error);
    // Don't clear on network error - might be temporary
  }
}

/**
 * Show the active session banner
 */
function showActiveSessionBanner(storedSession, sessionData) {
  const banner = document.getElementById('active-session-banner');
  if (!banner) return;

  const level = sessionData?.universe_level || storedSession.universeLevel;
  const boxId = sessionData?.box_id || storedSession.boxId;

  document.getElementById('banner-level').textContent = level;
  document.getElementById('banner-box').textContent = boxId;
  document.getElementById('btn-rejoin-session').href = `/session.html?id=${storedSession.id}`;

  banner.classList.remove('hidden');
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

  // Color picker for start session
  document.querySelectorAll('#start-session .color-btn-labeled').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!btn.classList.contains('disabled')) {
        selectColor(btn.dataset.color, 'player-color', '#start-session');
      }
    });
  });

  // Color picker for join session
  document.querySelectorAll('#join-session .color-btn-labeled').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!btn.classList.contains('disabled')) {
        selectColor(btn.dataset.color, 'join-player-color', '#join-session');
      }
    });
  });

  // Restore saved color for start session (join session will be handled when showing)
  const savedColor = localStorage.getItem('neutronium_player_color');
  if (savedColor) {
    selectColor(savedColor, 'player-color', '#start-session');
  }
}

/**
 * Select a figure color
 */
function selectColor(color, inputId, containerSelector) {
  // Check if color is disabled (taken)
  const btn = document.querySelector(`${containerSelector} .color-btn-labeled[data-color="${color}"]`);
  if (btn && btn.classList.contains('disabled')) {
    return; // Don't select disabled colors
  }

  document.getElementById(inputId).value = color;
  document.querySelectorAll(`${containerSelector} .color-btn-labeled`).forEach(b => {
    b.classList.toggle('selected', b.dataset.color === color);
  });
  localStorage.setItem('neutronium_player_color', color);
}

/**
 * Update step indicator
 */
function updateStepIndicator(step) {
  document.querySelectorAll('.step').forEach((el, idx) => {
    el.classList.remove('active', 'completed');
    if (idx + 1 < step) el.classList.add('completed');
    if (idx + 1 === step) el.classList.add('active');
  });
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
  updateStepIndicator(2);

  const statusText = document.getElementById('box-status-text');
  const startSession = document.getElementById('start-session');
  const joinSession = document.getElementById('join-session');

  if (data.activeSession) {
    // Active session exists
    activeSession = data.activeSession;
    statusText.textContent = 'Join the game in progress!';
    startSession.classList.add('hidden');
    joinSession.classList.remove('hidden');

    // Handle both snake_case (API) and camelCase
    const level = data.activeSession.universe_level || data.activeSession.universeLevel;
    document.getElementById('active-level').textContent = level;
    document.getElementById('active-players').textContent = data.activeSession.playerCount || '?';

    // Disable taken colors
    const takenColors = data.activeSession.takenColors || [];
    updateColorAvailability('#join-session', takenColors);

    // Try to restore saved color if available
    const savedColor = localStorage.getItem('neutronium_player_color');
    if (savedColor && !takenColors.includes(savedColor)) {
      selectColor(savedColor, 'join-player-color', '#join-session');
    }
  } else {
    // No active session
    activeSession = null;
    statusText.textContent = 'Set up your player and start!';
    startSession.classList.remove('hidden');
    joinSession.classList.add('hidden');

    // Reset all colors to available for new session
    updateColorAvailability('#start-session', []);
  }
}

/**
 * Update color picker availability based on taken colors
 */
function updateColorAvailability(containerSelector, takenColors) {
  document.querySelectorAll(`${containerSelector} .color-btn-labeled`).forEach(btn => {
    const color = btn.dataset.color;
    const isTaken = takenColors.includes(color);

    btn.classList.toggle('disabled', isTaken);
    btn.disabled = isTaken;

    // If currently selected color is now taken, deselect it
    if (isTaken && btn.classList.contains('selected')) {
      btn.classList.remove('selected');
      const inputId = containerSelector === '#start-session' ? 'player-color' : 'join-player-color';
      document.getElementById(inputId).value = '';
    }
  });
}

/**
 * Start a new session
 */
async function startSession() {
  const playerName = document.getElementById('player-name')?.value.trim();
  const playerColor = document.getElementById('player-color')?.value;
  const universeLevel = parseInt(document.getElementById('universe-level')?.value || '1');

  if (!playerName) {
    alert('Please enter your name');
    return;
  }

  if (!playerColor) {
    alert('Please select your figure color');
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
        playerColor,
        playerId: window.NeutroniumAuth?.getOrCreateGuestId(),
      }),
      credentials: 'include',
    });

    const data = await response.json();

    if (response.ok) {
      // Store the actual player ID from the API
      if (data.player?.id) {
        window.NeutroniumAuth?.setPlayerId(data.player.id);
      }
      // Store active session for rejoin capability
      window.NeutroniumAuth?.setActiveSession(data.session);
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
  const playerColor = document.getElementById('join-player-color')?.value;

  if (!playerName) {
    alert('Please enter your name');
    return;
  }

  if (!playerColor) {
    alert('Please select your figure color');
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
        playerColor,
        playerId: window.NeutroniumAuth?.getOrCreateGuestId(),
      }),
      credentials: 'include',
    });

    const data = await response.json();

    if (response.ok) {
      // Store the actual player ID from the API
      if (data.player?.id) {
        window.NeutroniumAuth?.setPlayerId(data.player.id);
      }
      // Store active session for rejoin capability
      window.NeutroniumAuth?.setActiveSession(data.session);
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
              <td>${escapeHtml(player.displayName || player.name)}</td>
              <td class="nn-value">${player.totalNn || player.totalBestNn || 0}</td>
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
  boxForm.classList.remove('hidden');
  boxIdInput.value = '';
  currentBoxId = null;
  activeSession = null;
  updateStepIndicator(1);
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

/**
 * Set up header hide-on-scroll behavior
 */
function setupHeaderScroll() {
  const header = document.querySelector('.header');
  if (!header) return;

  let lastScrollY = window.scrollY;
  let ticking = false;
  const scrollThreshold = 50; // Minimum scroll before hiding

  function updateHeader() {
    const currentScrollY = window.scrollY;

    // Only hide if scrolled past threshold
    if (currentScrollY > scrollThreshold) {
      if (currentScrollY > lastScrollY) {
        // Scrolling down - hide header
        header.classList.add('header-hidden');
      } else {
        // Scrolling up - show header
        header.classList.remove('header-hidden');
      }
    } else {
      // At top - always show header
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