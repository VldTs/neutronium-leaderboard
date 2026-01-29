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
 * Recalculate session level based on all players' max levels
 * Called when a player signs in while in a session
 */
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
    const { sessionId, playerId } = body;

    // Validate required fields
    if (!sessionId) {
      return withCors(errorResponse('sessionId is required'), request, env);
    }

    // Check if session exists and is active
    const { data: session, error: sessionError } = await supabase
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

    const previousLevel = session.universe_level;

    // Get all players in the session
    const { data: sessionPlayers, error: playersError } = await supabase
      .from('session_players')
      .select('player_id')
      .eq('session_id', sessionId);

    if (playersError || !sessionPlayers || sessionPlayers.length === 0) {
      console.error('Error getting session players:', playersError);
      return withCors(jsonResponse({
        success: true,
        session,
        levelChanged: false,
      }), request, env);
    }

    console.log(`Recalculating level for session ${sessionId} with ${sessionPlayers.length} players`);

    // Get max level for each player
    const playerMaxLevels = await Promise.all(
      sessionPlayers.map(async (sp) => {
        const maxLevel = await getPlayerMaxLevel(supabase, sp.player_id);
        return {
          playerId: sp.player_id,
          maxLevel,
        };
      })
    );

    console.log(`Player max levels: ${JSON.stringify(playerMaxLevels)}, current session level: ${previousLevel}`);

    // Session level is the minimum of all players' max levels
    // This allows the level to go UP when a guest signs in with a higher-level account
    const newSessionLevel = Math.min(...playerMaxLevels.map(p => p.maxLevel));

    console.log(`Calculated new session level: min(${playerMaxLevels.map(p => p.maxLevel).join(', ')}) = ${newSessionLevel}`);

    // Update the session level if changed
    if (newSessionLevel !== previousLevel) {
      const { data: updatedSession, error: updateError } = await supabase
        .from('sessions')
        .update({ universe_level: newSessionLevel })
        .eq('id', sessionId)
        .select()
        .single();

      if (updateError) {
        console.error('Error updating session level:', updateError);
        return withCors(errorResponse('Failed to update session level', 500), request, env);
      }

      return withCors(jsonResponse({
        success: true,
        session: updatedSession,
        previousLevel,
        newLevel: newSessionLevel,
        levelChanged: true,
        playerLevels: playerMaxLevels,
      }), request, env);
    }

    return withCors(jsonResponse({
      success: true,
      session,
      levelChanged: false,
      playerLevels: playerMaxLevels,
    }), request, env);
  } catch (error) {
    console.error('Recalculate level error:', error);
    return withCors(errorResponse(error.message || 'Internal server error', 500), request, env);
  }
}