import { createSupabaseClient } from '../../_shared/supabase.js';
import { jsonResponse, errorResponse, handleCors, withCors } from '../../_shared/response.js';

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
    if (!playerId) {
      return withCors(errorResponse('playerId is required'), request, env);
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

    // Check if player is in the session
    const { data: sessionPlayer, error: playerError } = await supabase
      .from('session_players')
      .select('*')
      .eq('session_id', sessionId)
      .eq('player_id', playerId)
      .single();

    if (playerError || !sessionPlayer) {
      return withCors(errorResponse('Player not in session', 404), request, env);
    }

    // Mark player as voted to end
    const { error: voteError } = await supabase
      .from('session_players')
      .update({ voted_end: true })
      .eq('session_id', sessionId)
      .eq('player_id', playerId);

    if (voteError) {
      throw voteError;
    }

    // Check if all players have voted to end
    const { data: allPlayers, error: allPlayersError } = await supabase
      .from('session_players')
      .select('voted_end')
      .eq('session_id', sessionId);

    if (allPlayersError) {
      throw allPlayersError;
    }

    const allVoted = allPlayers.every(p => p.voted_end);

    // If all players voted, complete the session
    if (allVoted) {
      const { error: completeError } = await supabase
        .from('sessions')
        .update({
          status: 'completed',
          ended_at: new Date().toISOString(),
        })
        .eq('id', sessionId);

      if (completeError) {
        throw completeError;
      }

      return withCors(jsonResponse({
        success: true,
        sessionCompleted: true,
        message: 'All players voted - session completed',
      }), request, env);
    }

    // Get vote count for response
    const votedCount = allPlayers.filter(p => p.voted_end).length;

    return withCors(jsonResponse({
      success: true,
      sessionCompleted: false,
      votedCount,
      totalPlayers: allPlayers.length,
      message: `Vote recorded (${votedCount}/${allPlayers.length})`,
    }), request, env);
  } catch (error) {
    console.error('End session error:', error);
    return withCors(errorResponse(error.message || 'Internal server error', 500), request, env);
  }
}