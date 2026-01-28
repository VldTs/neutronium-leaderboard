/**
 * Response utilities for consistent API responses
 */

/**
 * Create a JSON response
 * @param {Object} data - Response data
 * @param {number} status - HTTP status code
 * @param {Object} headers - Additional headers
 * @returns {Response}
 */
export function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}

/**
 * Create an error response
 * @param {string} message - Error message
 * @param {number} status - HTTP status code
 * @returns {Response}
 */
export function errorResponse(message, status = 400) {
  return jsonResponse({ error: message }, status);
}

/**
 * Create a success response
 * @param {Object} data - Response data
 * @param {number} status - HTTP status code
 * @returns {Response}
 */
export function successResponse(data, status = 200) {
  return jsonResponse({ success: true, ...data }, status);
}

/**
 * Handle CORS preflight requests
 * @param {Object} env - Environment variables
 * @returns {Response}
 */
export function handleCors(env) {
  const allowedOrigin = env.APP_URL || '*';

  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Max-Age': '86400',
    },
  });
}

/**
 * Add CORS headers to a response
 * @param {Response} response - Original response
 * @param {Object} env - Environment variables
 * @returns {Response}
 */
export function withCors(response, env) {
  const allowedOrigin = env.APP_URL || '*';
  const newHeaders = new Headers(response.headers);

  newHeaders.set('Access-Control-Allow-Origin', allowedOrigin);
  newHeaders.set('Access-Control-Allow-Credentials', 'true');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}