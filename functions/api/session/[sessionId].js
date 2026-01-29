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

    // Fetch reference scores from progress_journal if playerId provided
    const url = new URL(request.url);
    const playerId = url.searchParams.get('playerId');
    let refScores = null;

    if (playerId && session.universe_level) {
      const level = session.universe_level;
      const queries = [];

      // Best score from previous level (N-1)
      if (level > 1) {
        queries.push(
          supabase
            .from('progress_journal')
            .select('best_nn')
            .eq('player_id', playerId)
            .eq('universe_level', level - 1)
            .single()
        );
      } else {
        queries.push(Promise.resolve({ data: null }));
      }

      // Best score at current level (from previous games)
      queries.push(
        supabase
          .from('progress_journal')
          .select('best_nn')
          .eq('player_id', playerId)
          .eq('universe_level', level)
          .single()
      );

      const [prevResult, currResult] = await Promise.all(queries);

      refScores = {
        previousLevelBest: prevResult.data?.best_nn ?? null,
        currentLevelBest: currResult.data?.best_nn ?? null,
      };
    }

    // Check for next session if this one is completed
    let nextSession = null;
    if (session.status === 'completed') {
      const nextLevel = session.universe_level + 1;
      if (nextLevel <= 13) {
        // Look for an active session at the next level for the same box
        const { data: nextActiveSession } = await supabase
          .from('sessions')
          .select('id, universe_level, status')
          .eq('box_id', session.box_id)
          .eq('universe_level', nextLevel)
          .eq('status', 'active')
          .single();

        if (nextActiveSession) {
          nextSession = {
            id: nextActiveSession.id,
            universeLevel: nextActiveSession.universe_level,
          };
        }
      }
    }

    const responsePayload = {
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
      nextSession,
    };

    if (refScores) {
      responsePayload.referenceScores = refScores;
    }

    return withCors(jsonResponse(responsePayload), env);
  } catch (error) {
    console.error('Session get error:', error);
    return withCors(errorResponse(error.message || 'Internal server error', 500), env);
  }
}