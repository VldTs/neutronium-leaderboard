/**
 * Profile page logic for Neutronium Leaderboard
 */

// DOM Elements
const profileLoading = document.getElementById('profile-loading');
const profileGuest = document.getElementById('profile-guest');
const profileContent = document.getElementById('profile-content');
const upgradeModal = document.getElementById('upgrade-modal');

// State
let currentUser = null;
let viewingPlayerId = null;
let isOwnProfile = false;

/**
 * Initialize the profile page
 */
async function init() {
  // Check for active session and show banner
  await checkActiveSession();

  // Check if viewing specific player or own profile
  const urlParams = new URLSearchParams(window.location.search);
  viewingPlayerId = urlParams.get('id');

  // Get current user
  currentUser = await window.NeutroniumAuth?.getCurrentUser();

  // If no specific player ID and not logged in, check for guest ID
  if (!viewingPlayerId) {
    if (currentUser) {
      viewingPlayerId = currentUser.id;
      isOwnProfile = true;
    } else {
      const guestId = localStorage.getItem('neutronium_guest_id');
      if (guestId) {
        viewingPlayerId = guestId;
        isOwnProfile = true;
      }
    }
  } else {
    isOwnProfile = currentUser?.id === viewingPlayerId ||
      viewingPlayerId === localStorage.getItem('neutronium_guest_id');
  }

  // If still no player ID, show login prompt
  if (!viewingPlayerId) {
    showGuestPrompt();
    return;
  }

  // Load profile data
  await loadProfile();

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
    const response = await fetch(`/api/session/${storedSession.id}`);
    if (!response.ok) {
      window.NeutroniumAuth?.clearActiveSession();
      return;
    }

    const data = await response.json();
    if (data.session?.status !== 'active') {
      window.NeutroniumAuth?.clearActiveSession();
      return;
    }

    // Session is still active - show banner
    const banner = document.getElementById('profile-active-session');
    if (banner) {
      const level = data.session?.universe_level || storedSession.universeLevel;
      const boxId = data.session?.box_id || storedSession.boxId;

      document.getElementById('profile-session-level').textContent = level;
      document.getElementById('profile-session-box').textContent = boxId;
      document.getElementById('btn-profile-rejoin').href = `/session.html?id=${storedSession.id}`;

      banner.classList.remove('hidden');
    }
  } catch (error) {
    console.error('Error checking active session:', error);
  }
}

/**
 * Set up event listeners
 */
function setupEventListeners() {
  document.getElementById('btn-send-magic-link')?.addEventListener('click', sendMagicLinkFromLogin);
  document.getElementById('btn-upgrade')?.addEventListener('click', showUpgradeModal);
  document.getElementById('btn-cancel-upgrade')?.addEventListener('click', hideUpgradeModal);
  document.getElementById('btn-confirm-upgrade')?.addEventListener('click', sendMagicLinkFromUpgrade);
}

/**
 * Show guest login prompt
 */
function showGuestPrompt() {
  profileLoading.classList.add('hidden');
  profileGuest.classList.remove('hidden');
}

/**
 * Load profile data
 */
async function loadProfile() {
  try {
    const response = await fetch(`/api/player/${viewingPlayerId}`);

    if (response.status === 404) {
      // Player not found - show guest prompt for own profile, error for others
      if (isOwnProfile) {
        showGuestPrompt();
      } else {
        profileLoading.classList.add('hidden');
        profileContent.classList.remove('hidden');
        profileContent.innerHTML = `
          <div class="card text-center">
            <h3 class="mb-md">Player Not Found</h3>
            <p class="text-muted">This player profile doesn't exist.</p>
          </div>
        `;
      }
      return;
    }

    if (!response.ok) {
      throw new Error('Failed to load profile');
    }

    const data = await response.json();
    renderProfile(data);
  } catch (error) {
    console.error('Error loading profile:', error);
    showGuestPrompt();
  }
}

/**
 * Render profile data
 * @param {Object} data - Profile data
 */
function renderProfile(data) {
  profileLoading.classList.add('hidden');
  profileContent.classList.remove('hidden');

  const player = data.player;
  const stats = data.stats || {};
  const progressJournal = data.progressJournal || [];

  // Player info
  document.getElementById('profile-initial').textContent = player.displayName.charAt(0).toUpperCase();
  document.getElementById('profile-name').textContent = player.displayName;
  document.getElementById('profile-joined').textContent = formatDate(player.createdAt);

  // Show upgrade button for guest profiles
  if (isOwnProfile && player.isGuest) {
    document.getElementById('guest-upgrade').classList.remove('hidden');
  }

  // Stats
  document.getElementById('stat-total-nn').textContent = stats.totalBestNn || 0;
  document.getElementById('stat-games').textContent = stats.totalGames || 0;
  document.getElementById('stat-levels').textContent = stats.highestLevel || 0;
  document.getElementById('stat-race').textContent = stats.favoriteRace || '-';

  // Progress Journal Grid
  renderJournalGrid(progressJournal);

  // Recent sessions (if available)
  renderRecentSessions(data.recentSessions);
}

/**
 * Render progress journal grid
 * @param {Array} journal - Progress journal entries
 */
function renderJournalGrid(journal) {
  const grid = document.getElementById('journal-grid');

  // Create map of level -> score
  const scoreMap = {};
  journal.forEach(entry => {
    scoreMap[entry.level] = entry;
  });

  // Render all 13 levels
  grid.innerHTML = Array.from({ length: 13 }, (_, i) => {
    const level = i + 1;
    const entry = scoreMap[level];
    const hasScore = entry && entry.bestNn !== null;

    return `
      <div class="journal-level ${hasScore ? 'completed' : 'empty'}">
        <span class="journal-level-number">LVL ${level}</span>
        <span class="journal-level-score">${hasScore ? entry.bestNn : '-'}</span>
      </div>
    `;
  }).join('');
}

/**
 * Render recent sessions
 * @param {Array} sessions - Recent sessions
 */
function renderRecentSessions(sessions) {
  const container = document.getElementById('recent-sessions');

  if (!sessions || sessions.length === 0) {
    container.innerHTML = '<p class="text-muted">No sessions yet.</p>';
    return;
  }

  container.innerHTML = sessions.map(session => `
    <div class="player-card">
      <div class="player-info">
        <div class="player-name">
          Level ${session.universeLevel} • ${formatDate(session.playedAt)}
        </div>
        <div class="player-meta">
          ${session.race ? `${session.race} • ` : ''}
          <span class="nn-value">${session.finalNn}</span>
          ${session.newBest ? '<span class="badge badge-new-best ml-sm">New Best!</span>' : ''}
        </div>
      </div>
    </div>
  `).join('');
}

/**
 * Send magic link from login form
 */
async function sendMagicLinkFromLogin() {
  const email = document.getElementById('login-email')?.value.trim();
  if (!email) {
    alert('Please enter your email');
    return;
  }

  await sendMagicLink(email);
  document.getElementById('magic-link-sent').classList.remove('hidden');
}

/**
 * Show upgrade modal
 */
function showUpgradeModal() {
  upgradeModal.classList.add('active');
}

/**
 * Hide upgrade modal
 */
function hideUpgradeModal() {
  upgradeModal.classList.remove('active');
}

/**
 * Send magic link from upgrade modal
 */
async function sendMagicLinkFromUpgrade() {
  const email = document.getElementById('upgrade-email')?.value.trim();
  if (!email) {
    alert('Please enter your email');
    return;
  }

  await sendMagicLink(email, viewingPlayerId);
  hideUpgradeModal();
  alert('Check your email! Click the link to save your progress.');
}

/**
 * Send magic link to email
 * @param {string} email - Email address
 * @param {string|null} playerId - Optional player ID to link
 */
async function sendMagicLink(email, playerId = null) {
  try {
    const result = await window.NeutroniumAuth?.sendMagicLink(email, playerId);
    if (!result?.success) {
      alert(result?.error || 'Failed to send magic link');
    }
  } catch (error) {
    console.error('Error sending magic link:', error);
    alert('Network error. Please try again.');
  }
}

/**
 * Format date for display
 * @param {string} dateStr - ISO date string
 * @returns {string} Formatted date
 */
function formatDate(dateStr) {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

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