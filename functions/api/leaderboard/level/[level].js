import { createSupabaseClient } from '../../../_shared/supabase.js';
import { jsonResponse, errorResponse, handleCors, withCors } from '../../../_shared/response.js';

export async function onRequest(context) {
  const { params, env, request } = context;
  const level = parseInt(params.level, 10);

  if (request.method === 'OPTIONS') {
    return handleCors(request, env);
  }

  if (request.method !== 'GET') {
    return withCors(errorResponse('Method not allowed', 405), request, env);
  }

  // Validate level
  if (isNaN(level) || level < 1 || level > 13) {
    return withCors(errorResponse('Level must be between 1 and 13', 400), request, env);
  }

  try {
    const supabase = createSupabaseClient(env);
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);

    // Get rankings for specific level
    const { data: rankings, error, count } = await supabase
      .from('progress_journal')
      .select(`
        player_id,
        best_nn,
        achieved_at,
        players!inner(id, display_name, is_guest)
      `, { count: 'exact' })
      .eq('universe_level', level)
      .order('best_nn', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      throw error;
    }

    const formattedRankings = (rankings || []).map((record, index) => ({
      rank: offset + index + 1,
      playerId: record.player_id,
      name: record.players.display_name,
      isGuest: record.players.is_guest,
      bestNn: record.best_nn,
      achievedAt: record.achieved_at,
    }));

    return withCors(jsonResponse({
      rankings: formattedRankings,
      total: count || 0,
      level,
      limit,
      offset,
    }), request, env);
  } catch (error) {
    console.error('Level leaderboard API error:', error);
    return withCors(errorResponse(error.message || 'Internal server error', 500), request, env);
  }
}