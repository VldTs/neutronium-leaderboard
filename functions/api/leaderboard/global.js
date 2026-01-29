import { createSupabaseClient } from '../../_shared/supabase.js';
import { jsonResponse, errorResponse, handleCors, withCors } from '../../_shared/response.js';

export async function onRequest(context) {
  const { env, request } = context;

  if (request.method === 'OPTIONS') {
    return handleCors(request, env);
  }

  if (request.method !== 'GET') {
    return withCors(errorResponse('Method not allowed', 405), request, env);
  }

  try {
    const supabase = createSupabaseClient(env);
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);

    // Aggregate best scores across all levels for each player
    // Total Nn = sum of best_nn from all levels
    const { data: rankings, error } = await supabase
      .from('progress_journal')
      .select(`
        player_id,
        best_nn,
        players!inner(id, display_name, is_guest)
      `)
      .order('best_nn', { ascending: false });

    if (error) {
      throw error;
    }

    // Aggregate by player: sum their best_nn across all levels
    const playerScores = new Map();

    for (const record of rankings || []) {
      const playerId = record.player_id;
      if (!playerScores.has(playerId)) {
        playerScores.set(playerId, {
          playerId,
          name: record.players.display_name,
          isGuest: record.players.is_guest,
          totalBestNn: 0,
          levelsCompleted: 0,
        });
      }
      const player = playerScores.get(playerId);
      player.totalBestNn += record.best_nn || 0;
      player.levelsCompleted += 1;
    }

    // Sort by total Nn descending
    const sortedRankings = Array.from(playerScores.values())
      .sort((a, b) => b.totalBestNn - a.totalBestNn)
      .slice(offset, offset + limit)
      .map((player, index) => ({
        rank: offset + index + 1,
        ...player,
      }));

    return withCors(jsonResponse({
      rankings: sortedRankings,
      total: playerScores.size,
      limit,
      offset,
    }), request, env);
  } catch (error) {
    console.error('Leaderboard API error:', error);
    return withCors(errorResponse(error.message || 'Internal server error', 500), request, env);
  }
}