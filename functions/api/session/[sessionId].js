import { createSupabaseClient } from '../../_shared/supabase.js';
import { jsonResponse, errorResponse, handleCors, withCors } from '../../_shared/response.js';

export async function onRequest(context) {
  const { params, env, request } = context;
  const sessionId = params.sessionId;

  if (request.method === 'OPTIONS') {
    return handleCors(env);
  }

  if (request.method !== 'GET') {
    return withCors(errorResponse('Method not allowed', 405), env);
  }

  try {
    const supabase = createSupabaseClient(env);

    // Get session with all players
    const { data: session, error: sessionError } = await supabase
      .from('sessions')
      .select(`
        *,
        game_boxes(box_id, registered_at),
        host:players!sessions_host_player_id_fkey(id, display_name)
      `)
      .eq('id', sessionId)
      .single();

    if (sessionError) {
      if (sessionError.code === 'PGRST116') {
        return withCors(errorResponse('Session not found', 404), env);
      }
      throw sessionError;
    }

    // Get all players in session
    const { data: sessionPlayers, error: playersError } = await supabase
      .from('session_players')
      .select(`
        *,
        player:players(id, display_name, is_guest)
      `)
      .eq('session_id', sessionId)
      .order('joined_at', { ascending: true });

    if (playersError) {
      throw playersError;
    }

    // Calculate session stats
    const totalPlayers = sessionPlayers.length;
    const playersVotedEnd = sessionPlayers.filter(sp => sp.voted_end).length;
    const playersSubmittedScore = sessionPlayers.filter(sp => sp.final_nn !== null).length;

    return withCors(jsonResponse({
      session: {
        ...session,
        players: sessionPlayers,
      },
      stats: {
        totalPlayers,
        playersVotedEnd,
        playersSubmittedScore,
        allVotedEnd: totalPlayers > 0 && playersVotedEnd === totalPlayers,
        allSubmittedScore: totalPlayers > 0 && playersSubmittedScore === totalPlayers,
      },
    }), env);
  } catch (error) {
    console.error('Session get error:', error);
    return withCors(errorResponse(error.message || 'Internal server error', 500), env);
  }
}