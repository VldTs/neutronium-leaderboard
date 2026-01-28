/**
 * Authentication utilities for JWT token handling
 */

import * as jose from 'jose';

const TOKEN_COOKIE_NAME = 'auth_token';
const TOKEN_EXPIRY = '7d';

/**
 * Create a signed JWT token for a player
 * @param {Object} player - Player data
 * @param {string} secret - JWT secret
 * @returns {Promise<string>} - Signed JWT token
 */
export async function createAuthToken(player, secret) {
  const secretKey = new TextEncoder().encode(secret);

  const token = await new jose.SignJWT({
    sub: player.id,
    name: player.display_name,
    isGuest: player.is_guest,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(TOKEN_EXPIRY)
    .sign(secretKey);

  return token;
}

/**
 * Verify and decode a JWT token
 * @param {string} token - JWT token
 * @param {string} secret - JWT secret
 * @returns {Promise<Object|null>} - Decoded payload or null if invalid
 */
export async function verifyAuthToken(token, secret) {
  try {
    const secretKey = new TextEncoder().encode(secret);
    const { payload } = await jose.jwtVerify(token, secretKey);
    return payload;
  } catch (error) {
    return null;
  }
}

/**
 * Extract auth token from request cookies
 * @param {Request} request - Incoming request
 * @returns {string|null} - Token or null
 */
export function getTokenFromCookies(request) {
  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) return null;

  const cookies = cookieHeader.split(';').reduce((acc, cookie) => {
    const [key, value] = cookie.trim().split('=');
    acc[key] = value;
    return acc;
  }, {});

  return cookies[TOKEN_COOKIE_NAME] || null;
}

/**
 * Create Set-Cookie header for auth token
 * @param {string} token - JWT token
 * @param {Object} env - Environment variables
 * @returns {string} - Set-Cookie header value
 */
export function createAuthCookie(token, env) {
  const domain = env.COOKIE_DOMAIN || 'localhost';
  const secure = env.APP_URL?.startsWith('https') ? 'Secure; ' : '';

  return `${TOKEN_COOKIE_NAME}=${token}; HttpOnly; ${secure}SameSite=Strict; Path=/; Max-Age=${7 * 24 * 60 * 60}${domain !== 'localhost' ? `; Domain=${domain}` : ''}`;
}

/**
 * Create Set-Cookie header to clear auth token
 * @param {Object} env - Environment variables
 * @returns {string} - Set-Cookie header value
 */
export function clearAuthCookie(env) {
  const domain = env.COOKIE_DOMAIN || 'localhost';
  return `${TOKEN_COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${domain !== 'localhost' ? `; Domain=${domain}` : ''}`;
}

/**
 * Get current authenticated player from request
 * @param {Request} request - Incoming request
 * @param {Object} env - Environment variables
 * @returns {Promise<Object|null>} - Player info or null
 */
export async function getCurrentPlayer(request, env) {
  const token = getTokenFromCookies(request);
  if (!token) return null;

  const payload = await verifyAuthToken(token, env.JWT_SECRET);
  if (!payload) return null;

  return {
    id: payload.sub,
    displayName: payload.name,
    isGuest: payload.isGuest,
  };
}