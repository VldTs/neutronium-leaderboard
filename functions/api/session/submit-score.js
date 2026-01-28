import { createSupabaseClient } from '../../_shared/supabase.js';
import { jsonResponse, errorResponse, handleCors, withCors } from '../../_shared/response.js';

export async function onRequest(context) {
  const { env, request } = context;

  if (request.method === 'OPTIONS') {
    return handleCors(env);
  }

  if (request.method !== 'POST') {
    return withCors(errorResponse('Method not allowed', 405), env);
  }

  try {
    const supabase = createSupabaseClient(env);
    const body = await request.json();
    const { sessionId, playerId, finalNn, race, startingNn } = body;

    // Validate required fields
    if (!sessionId) {
      return withCors(errorResponse('sessionId is required'), env);
    }
    if (!playerId) {
      return withCors(errorResponse('playerId is required'), env);
    }
    if (finalNn === undefined || finalNn === null) {
      return withCors(errorResponse('finalNn is required'), env);
    }

    // Validate race if provided
    const validRaces = ['Terano', 'Mi-TO', 'Iit', 'Asters'];
    if (race && !validRaces.includes(race)) {
      return withCors(errorResponse(`race must be one of: ${validRaces.join(', ')}`), env);
    }

    // Check if session exists and is active
    const { data: session, error: sessionError } = await supabase
      .from('sessions')
      .select('*')
      .eq('id', sessionId)
      .single();

    if (sessionError || !session) {
      return withCors(errorResponse('Session not found', 404), env);
    }

    if (session.status !== 'active') {
      return withCors(errorResponse('Session is not active', 400), env);
    }

    // Check if player is in the session
    const { data: sessionPlayer, error: playerError } = await supabase
      .from('session_players')
      .select('*')
      .eq('session_id', sessionId)
      .eq('player_id', playerId)
      .single();

    if (playerError || !sessionPlayer) {
      return withCors(errorResponse('Player not in session', 404), env);
    }

    // Update player's score
    const updateData = {
      final_nn: finalNn,
    };

    if (race) {
      updateData.race = race;
    }

    if (startingNn !== undefined) {
      updateData.starting_nn = startingNn;
    }

    const { data: updatedPlayer, error: updateError } = await supabase
      .from('session_players')
      .update(updateData)
      .eq('session_id', sessionId)
      .eq('player_id', playerId)
      .select()
      .single();

    if (updateError) {
      throw updateError;
    }

    return withCors(jsonResponse({
      success: true,
      sessionPlayer: updatedPlayer,
    }), env);
  } catch (error) {
    console.error('Submit score error:', error);
    return withCors(errorResponse(error.message || 'Internal server error', 500), env);
  }
}