import { createSupabaseClient } from '../../_shared/supabase.js';
import { jsonResponse, errorResponse, handleCors, withCors } from '../../_shared/response.js';

/**
 * Get a player's max unlocked level based on their progress
 * @param {object} supabase - Supabase client
 * @param {string} playerId - Player ID
 * @returns {number} Max unlocked level (1-13)
 */
async function getPlayerMaxLevel(supabase, playerId) {
  try {
    // First, check if player is a guest
    const { data: player, error: playerError } = await supabase
      .from('players')
      .select('is_guest')
      .eq('id', playerId)
      .single();

    if (playerError) {
      console.error('Error fetching player:', playerError);
      return 1;
    }

    // Guests always start at level 1
    if (player?.is_guest === true) {
      console.log(`Player ${playerId} is guest, max level = 1`);
      return 1;
    }

    // For authenticated players, check their progress
    const { data: progress, error: progressError } = await supabase
      .from('progress_journal')
      .select('universe_level')
      .eq('player_id', playerId);

    if (progressError) {
      console.error('Error fetching progress:', progressError);
      return 1;
    }

    if (!progress || progress.length === 0) {
      console.log(`Player ${playerId} has no progress, max level = 1`);
      return 1;
    }

    const maxCompletedLevel = Math.max(...progress.map(p => p.universe_level));
    // Can play up to max completed + 1, capped at 13
    const maxLevel = Math.min(maxCompletedLevel + 1, 13);
    console.log(`Player ${playerId} max completed level = ${maxCompletedLevel}, max level = ${maxLevel}`);
    return maxLevel;
  } catch (error) {
    console.error('Error getting player max level:', error);
    return 1;
  }
}

/**
 * Recalculate and update session level based on current level and all players' max levels
 * The session level should be the minimum of:
 * - The current session level (what was originally selected)
 * - All players' max unlocked levels
 *
 * Example: Player A (max 8) creates session at level 6, Player B (max 7) joins
 * Result: min(6, 8, 7) = 6 (stays at 6)
 *
 * Example: Player A (max 8) creates session at level 8, Player B (max 7) joins
 * Result: min(8, 8, 7) = 7 (adjusts to 7)
 *
 * @param {object} supabase - Supabase client
 * @param {string} sessionId - Session ID
 * @returns {object|null} Updated session or null on error
 */
async function recalculateSessionLevel(supabase, sessionId) {
  // Get current session level
  const { data: session, error: sessionError } = await supabase
    .from('sessions')
    .select('universe_level')
    .eq('id', sessionId)
    .single();

  if (sessionError || !session) {
    console.error('Error getting session:', sessionError);
    return null;
  }

  const currentSessionLevel = session.universe_level;

  // Get all players in the session
  const { data: sessionPlayers, error: playersError } = await supabase
    .from('session_players')
    .select('player_id')
    .eq('session_id', sessionId);

  if (playersError || !sessionPlayers || sessionPlayers.length === 0) {
    console.error('Error getting session players:', playersError);
    return null;
  }

  console.log(`Recalculating level for session ${sessionId} with ${sessionPlayers.length} players`);

  // Get max level for each player
  const playerMaxLevels = await Promise.all(
    sessionPlayers.map(sp => getPlayerMaxLevel(supabase, sp.player_id))
  );

  console.log(`Player max levels: ${JSON.stringify(playerMaxLevels)}, current session level: ${currentSessionLevel}`);

  // Session level is the minimum of all players' max levels
  // This allows the level to go UP when a guest signs in with a higher-level account
  const newSessionLevel = Math.min(...playerMaxLevels);

  console.log(`Calculated new session level: min(${playerMaxLevels.join(', ')}) = ${newSessionLevel}`);

  // Only update if level changed
  if (newSessionLevel === currentSessionLevel) {
    // Return current session data without updating
    const { data: fullSession } = await supabase
      .from('sessions')
      .select('*')
      .eq('id', sessionId)
      .single();
    return fullSession;
  }

  // Update the session level
  const { data: updatedSession, error: updateError } = await supabase
    .from('sessions')
    .update({ universe_level: newSessionLevel })
    .eq('id', sessionId)
    .select()
    .single();

  if (updateError) {
    console.error('Error updating session level:', updateError);
    return null;
  }

  return updatedSession;
}

export async function onRequest(context) {
  const { env, request } = context;

  if (request.method === 'OPTIONS') {
    return handleCors(request, env);
  }

  if (request.method !== 'POST') {
    return withCors(errorResponse('Method not allowed', 405), request, env);
  }

  try {
    const supabase = createSupabaseClient(env);
    const body = await request.json();
    const { sessionId, playerName, playerColor, playerId, replacePlayerId } = body;

    // Validate required fields
    if (!sessionId) {
      return withCors(errorResponse('sessionId is required'), request, env);
    }
    if (!playerName) {
      return withCors(errorResponse('playerName is required'), request, env);
    }

    // Validate color if provided
    const validColors = ['gray', 'pink', 'purple', 'green'];
    if (playerColor && !validColors.includes(playerColor)) {
      return withCors(errorResponse(`playerColor must be one of: ${validColors.join(', ')}`), request, env);
    }

    // Check if session exists and is active
    let { data: session, error: sessionError } = await supabase
      .from('sessions')
      .select('*')
      .eq('id', sessionId)
      .single();

    if (sessionError || !session) {
      return withCors(errorResponse('Session not found', 404), request, env);
    }

    if (session.status !== 'active') {
      return withCors(errorResponse('Session is not active', 400), request, env);
    }

    // Get or create player
    let player;
    console.log(`Join request - playerId: ${playerId}, playerName: ${playerName}`);

    if (playerId) {
      // Try to find existing player
      const { data: existingPlayer, error: findError } = await supabase
        .from('players')
        .select('*')
        .eq('id', playerId)
        .single();

      if (existingPlayer) {
        player = existingPlayer;
        console.log(`Found existing player: ${player.id}, is_guest: ${player.is_guest}, name: ${player.display_name}`);
      } else {
        // Player ID provided but not found - create new player
        console.log(`Player ID ${playerId} not found, creating new guest player. Find error: ${findError?.message}`);
        const { data: newPlayer, error: createError } = await supabase
          .from('players')
          .insert({
            display_name: playerName,
            is_guest: true,
          })
          .select()
          .single();

        if (createError) {
          throw createError;
        }
        player = newPlayer;
        console.log(`Created new guest player: ${player.id}`);
      }
    } else {
      // No player ID - create guest player
      console.log('No playerId provided, creating new guest player');
      const { data: newPlayer, error: createError } = await supabase
        .from('players')
        .insert({
          display_name: playerName,
          is_guest: true,
        })
        .select()
        .single();

      if (createError) {
        throw createError;
      }
      player = newPlayer;
      console.log(`Created new guest player: ${player.id}`);
    }

    // If replacing an old player (e.g., guest signed in and became authenticated),
    // remove the old player from the session first
    if (replacePlayerId && replacePlayerId !== player.id) {
      console.log(`Replacing old player ${replacePlayerId} with authenticated player ${player.id}`);
      const { error: removeError } = await supabase
        .from('session_players')
        .delete()
        .eq('session_id', sessionId)
        .eq('player_id', replacePlayerId);

      if (removeError) {
        console.error('Error removing old player from session:', removeError);
        // Continue anyway - the old player might not have been in the session
      }
    }

    // Check if player already in session
    const { data: existingEntry } = await supabase
      .from('session_players')
      .select('*')
      .eq('session_id', sessionId)
      .eq('player_id', player.id)
      .single();

    if (existingEntry) {
      // Player already in session - recalculate level (in case they signed in)
      const previousLevel = session.universe_level;
      const updatedSession = await recalculateSessionLevel(supabase, sessionId);
      const newLevel = updatedSession?.universe_level || previousLevel;
      const levelChanged = newLevel !== previousLevel;

      console.log(`Rejoin: previousLevel=${previousLevel}, newLevel=${newLevel}, levelChanged=${levelChanged}`);

      return withCors(jsonResponse({
        success: true,
        session: updatedSession || session,
        player,
        sessionPlayer: existingEntry,
        rejoined: true,
        levelChanged,
        previousLevel: levelChanged ? previousLevel : undefined,
        newLevel: levelChanged ? newLevel : undefined,
      }), request, env);
    }

    // Add player to session
    const { data: sessionPlayer, error: joinError } = await supabase
      .from('session_players')
      .insert({
        session_id: sessionId,
        player_id: player.id,
        race: playerColor || null, // Store color in race field
      })
      .select()
      .single();

    if (joinError) {
      throw joinError;
    }

    // Recalculate session level after adding new player
    const updatedSession = await recalculateSessionLevel(supabase, sessionId);
    const previousLevel = session.universe_level;
    const newLevel = updatedSession?.universe_level || previousLevel;
    const levelChanged = newLevel !== previousLevel;

    return withCors(jsonResponse({
      success: true,
      session: updatedSession || session,
      player,
      sessionPlayer,
      rejoined: false,
      levelChanged,
      previousLevel: levelChanged ? previousLevel : undefined,
      newLevel: levelChanged ? newLevel : undefined,
    }), request, env);
  } catch (error) {
    console.error('Session join error:', error);
    return withCors(errorResponse(error.message || 'Internal server error', 500), request, env);
  }
}