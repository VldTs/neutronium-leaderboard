/**
 * Auth state management for Neutronium Leaderboard
 */

const AUTH_STORAGE_KEY = 'neutronium_guest_id';
const PLAYER_NAME_KEY = 'neutronium_player_name';
const ACTIVE_SESSION_KEY = 'neutronium_active_session';

/**
 * Get or create a guest ID for anonymous players
 * @returns {string} Guest ID
 */
function getOrCreateGuestId() {
  let guestId = localStorage.getItem(AUTH_STORAGE_KEY);
  if (!guestId) {
    guestId = crypto.randomUUID();
    localStorage.setItem(AUTH_STORAGE_KEY, guestId);
  }
  return guestId;
}

/**
 * Get stored player name
 * @returns {string|null} Player name or null
 */
function getStoredPlayerName() {
  return localStorage.getItem(PLAYER_NAME_KEY);
}

/**
 * Store player name
 * @param {string} name - Player name
 */
function setStoredPlayerName(name) {
  localStorage.setItem(PLAYER_NAME_KEY, name);
}

/**
 * Get current authenticated user
 * @returns {Promise<Object|null>} Player data or null
 */
async function getCurrentUser() {
  try {
    const response = await fetch('/api/auth/me', {
      credentials: 'include',
    });
    const data = await response.json();

    if (data.authenticated && data.player) {
      return data.player;
    }
    return null;
  } catch (error) {
    console.error('Error fetching current user:', error);
    return null;
  }
}

/**
 * Send magic link to email
 * @param {string} email - Email address
 * @param {string|null} playerId - Optional player ID to link
 * @returns {Promise<Object>} Response data
 */
async function sendMagicLink(email, playerId = null) {
  const response = await fetch('/api/auth/magic-link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, playerId }),
    credentials: 'include',
  });

  return response.json();
}

/**
 * Check if user is logged in (has auth cookie)
 * @returns {Promise<boolean>}
 */
async function isLoggedIn() {
  const user = await getCurrentUser();
  return user !== null;
}

/**
 * Set player ID (used after creating/joining session)
 * @param {string} id - Player ID from API
 */
function setPlayerId(id) {
  localStorage.setItem(AUTH_STORAGE_KEY, id);
}

/**
 * Get current player ID
 * @returns {string|null} Player ID or null
 */
function getPlayerId() {
  return localStorage.getItem(AUTH_STORAGE_KEY);
}

/**
 * Set active session data
 * @param {Object} sessionData - Session data including id, boxId, universeLevel
 */
function setActiveSession(sessionData) {
  if (sessionData) {
    localStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify({
      id: sessionData.id,
      boxId: sessionData.box_id || sessionData.boxId,
      universeLevel: sessionData.universe_level || sessionData.universeLevel,
      joinedAt: new Date().toISOString(),
    }));
  }
}

/**
 * Get active session data
 * @returns {Object|null} Session data or null
 */
function getActiveSession() {
  const data = localStorage.getItem(ACTIVE_SESSION_KEY);
  if (data) {
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Clear active session data
 */
function clearActiveSession() {
  localStorage.removeItem(ACTIVE_SESSION_KEY);
}

// Export for use in other scripts
window.NeutroniumAuth = {
  getOrCreateGuestId,
  getStoredPlayerName,
  setStoredPlayerName,
  getCurrentUser,
  sendMagicLink,
  isLoggedIn,
  setPlayerId,
  getPlayerId,
  setActiveSession,
  getActiveSession,
  clearActiveSession,
};