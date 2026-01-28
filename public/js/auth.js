/**
 * Auth state management for Neutronium Leaderboard
 */

const AUTH_STORAGE_KEY = 'neutronium_guest_id';
const PLAYER_NAME_KEY = 'neutronium_player_name';

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

// Export for use in other scripts
window.NeutroniumAuth = {
  getOrCreateGuestId,
  getStoredPlayerName,
  setStoredPlayerName,
  getCurrentUser,
  sendMagicLink,
  isLoggedIn,
};