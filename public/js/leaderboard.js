/**
 * Leaderboard page logic for Neutronium Leaderboard
 */

// DOM Elements
const leaderboardLoading = document.getElementById('leaderboard-loading');
const leaderboardContent = document.getElementById('leaderboard-content');
const leaderboardEmpty = document.getElementById('leaderboard-empty');
const rankingsBody = document.getElementById('rankings-body');
const yourPosition = document.getElementById('your-position');

// State
let currentLevel = 'all';
let currentPage = 0;
let totalPages = 1;
const pageSize = 50;

/**
 * Initialize the leaderboard page
 */
async function init() {
  // Check for active session
  await checkActiveSession();

  // Check for level in URL
  const urlParams = new URLSearchParams(window.location.search);
  const levelParam = urlParams.get('level');
  if (levelParam && levelParam !== 'all') {
    currentLevel = levelParam;
  }

  // Set up event listeners
  setupEventListeners();

  // Update active tab
  updateActiveTabs();
  updateScoreHeader();

  // Load leaderboard
  await loadLeaderboard();

  // Load user position if logged in
  await loadUserPosition();
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
    const banner = document.getElementById('leaderboard-active-session');
    if (banner) {
      const level = data.session?.universe_level || storedSession.universeLevel;
      const boxId = data.session?.box_id || storedSession.boxId;

      document.getElementById('leaderboard-session-level').textContent = level;
      document.getElementById('leaderboard-session-box').textContent = boxId;
      document.getElementById('btn-leaderboard-rejoin').href = `/session.html?id=${storedSession.id}`;

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
  // Level tabs
  document.querySelectorAll('.level-tab').forEach(tab => {
    tab.addEventListener('click', async (e) => {
      currentLevel = e.target.dataset.level;
      currentPage = 0;
      updateActiveTabs();
      updateScoreHeader();
      await loadLeaderboard();
    });
  });

  // Pagination
  document.getElementById('btn-prev')?.addEventListener('click', async () => {
    if (currentPage > 0) {
      currentPage--;
      await loadLeaderboard();
    }
  });

  document.getElementById('btn-next')?.addEventListener('click', async () => {
    if (currentPage < totalPages - 1) {
      currentPage++;
      await loadLeaderboard();
    }
  });
}

/**
 * Update active tab styling
 */
function updateActiveTabs() {
  document.querySelectorAll('.level-tab').forEach(tab => {
    const isActive = tab.dataset.level === currentLevel;
    tab.classList.toggle('btn-primary', isActive);
    tab.classList.toggle('btn-secondary', !isActive);
    tab.classList.toggle('active', isActive);
  });
}

/**
 * Update score header based on view type
 */
function updateScoreHeader() {
  const header = document.getElementById('score-header');
  if (header) {
    header.textContent = currentLevel === 'all' ? 'Total Nn' : 'Best Nn';
  }
}

/**
 * Load leaderboard data
 */
async function loadLeaderboard() {
  leaderboardLoading.classList.remove('hidden');
  leaderboardContent.classList.add('hidden');
  leaderboardEmpty.classList.add('hidden');

  try {
    let url;
    if (currentLevel === 'all') {
      url = `/api/leaderboard/global?limit=${pageSize}&offset=${currentPage * pageSize}`;
    } else {
      url = `/api/leaderboard/level/${currentLevel}?limit=${pageSize}&offset=${currentPage * pageSize}`;
    }

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error('Failed to load leaderboard');
    }

    const data = await response.json();

    if (!data.rankings || data.rankings.length === 0) {
      leaderboardLoading.classList.add('hidden');
      leaderboardEmpty.classList.remove('hidden');
      return;
    }

    renderLeaderboard(data);
  } catch (error) {
    console.error('Error loading leaderboard:', error);
    leaderboardLoading.classList.add('hidden');
    leaderboardEmpty.classList.remove('hidden');
  }
}

/**
 * Render leaderboard data
 * @param {Object} data - Leaderboard data
 */
function renderLeaderboard(data) {
  const currentPlayerId = window.NeutroniumAuth?.getPlayerId() || localStorage.getItem('neutronium_guest_id');

  rankingsBody.innerHTML = data.rankings.map(player => {
    const isMe = player.playerId === currentPlayerId;
    const rankClass = player.rank <= 3 ? `rank-${player.rank}` : '';
    // Handle both field name variations
    const playerName = player.name || player.displayName || 'Unknown';
    const score = currentLevel === 'all'
      ? (player.totalBestNn || player.totalNn || 0)
      : (player.bestNn || 0);
    const levelsInfo = currentLevel === 'all'
      ? `${player.levelsCompleted || 0}`
      : formatDate(player.achievedAt);

    return `
      <tr ${isMe ? 'style="background: rgba(139, 92, 246, 0.1);"' : ''}>
        <td class="rank-cell ${rankClass}">#${player.rank}</td>
        <td>
          <a href="/profile.html?id=${player.playerId}">${escapeHtml(playerName)}</a>
          ${isMe ? '<span class="badge badge-you ml-sm">You</span>' : ''}
        </td>
        <td class="nn-value">${score}</td>
        <td class="text-muted">${levelsInfo}</td>
      </tr>
    `;
  }).join('');

  // Update pagination
  totalPages = Math.ceil(data.total / pageSize);
  updatePagination(data.total);

  leaderboardLoading.classList.add('hidden');
  leaderboardContent.classList.remove('hidden');
}

/**
 * Update pagination controls
 * @param {number} total - Total number of results
 */
function updatePagination(total) {
  const pagination = document.getElementById('pagination');
  const btnPrev = document.getElementById('btn-prev');
  const btnNext = document.getElementById('btn-next');
  const pageInfo = document.getElementById('page-info');

  if (total <= pageSize) {
    pagination.classList.add('hidden');
    return;
  }

  pagination.classList.remove('hidden');
  btnPrev.disabled = currentPage === 0;
  btnNext.disabled = currentPage >= totalPages - 1;
  pageInfo.textContent = `Page ${currentPage + 1} of ${totalPages}`;
}

/**
 * Load current user's position
 */
async function loadUserPosition() {
  // Get player ID from auth or localStorage
  const playerId = window.NeutroniumAuth?.getPlayerId() || localStorage.getItem('neutronium_guest_id');
  if (!playerId) {
    yourPosition.classList.add('hidden');
    return;
  }

  try {
    const response = await fetch(`/api/player/${playerId}`);
    if (!response.ok) {
      yourPosition.classList.add('hidden');
      return;
    }

    const data = await response.json();

    if (data.stats && data.stats.totalBestNn > 0) {
      yourPosition.classList.remove('hidden');
      document.getElementById('your-rank').textContent = data.stats.globalRank ? `#${data.stats.globalRank}` : '-';
      document.getElementById('your-score').textContent = data.stats.totalBestNn || 0;
      document.getElementById('your-levels').textContent = `${data.stats.levelsCompleted || 0} levels completed`;
    } else {
      yourPosition.classList.add('hidden');
    }
  } catch (error) {
    console.error('Error loading user position:', error);
    yourPosition.classList.add('hidden');
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
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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