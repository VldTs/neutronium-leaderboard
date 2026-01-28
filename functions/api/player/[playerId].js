import { createSupabaseClient } from '../../_shared/supabase.js';
import { jsonResponse, errorResponse, handleCors, withCors } from '../../_shared/response.js';

export async function onRequest(context) {
  const { params, env, request } = context;
  const playerId = params.playerId;

  if (request.method === 'OPTIONS') {
    return handleCors(env);
  }

  if (request.method !== 'GET') {
    return withCors(errorResponse('Method not allowed', 405), env);
  }

  try {
    const supabase = createSupabaseClient(env);

    // Get player info
    const { data: player, error: playerError } = await supabase
      .from('players')
      .select('id, display_name, is_guest, created_at')
      .eq('id', playerId)
      .single();

    if (playerError && playerError.code !== 'PGRST116') {
      throw playerError;
    }

    if (!player) {
      return withCors(errorResponse('Player not found', 404), env);
    }

    // Get player's progress journal
    const { data: progress, error: progressError } = await supabase
      .from('progress_journal')
      .select('universe_level, best_nn, achieved_at')
      .eq('player_id', playerId)
      .order('universe_level', { ascending: true });

    if (progressError) {
      throw progressError;
    }

    // Calculate stats
    const totalBestNn = (progress || []).reduce((sum, p) => sum + (p.best_nn || 0), 0);
    const highestLevel = progress?.length > 0 ? Math.max(...progress.map(p => p.universe_level)) : 0;
    const levelsCompleted = progress?.length || 0;

    // Get global rank by counting players with higher total Nn
    let globalRank = null;
    if (totalBestNn > 0) {
      // Get all players' total scores
      const { data: allProgress } = await supabase
        .from('progress_journal')
        .select('player_id, best_nn');

      if (allProgress) {
        const playerTotals = new Map();
        for (const record of allProgress) {
          const pid = record.player_id;
          playerTotals.set(pid, (playerTotals.get(pid) || 0) + (record.best_nn || 0));
        }

        // Sort by total Nn
        const sortedPlayers = Array.from(playerTotals.entries())
          .sort((a, b) => b[1] - a[1]);

        // Find this player's rank
        const playerIndex = sortedPlayers.findIndex(([pid]) => pid === playerId);
        if (playerIndex !== -1) {
          globalRank = playerIndex + 1;
        }
      }
    }

    // Get recent sessions
    const { data: recentSessions, error: sessionsError } = await supabase
      .from('session_players')
      .select(`
        session_id,
        starting_nn,
        final_nn,
        race,
        sessions!inner(id, box_id, universe_level, status, started_at, ended_at)
      `)
      .eq('player_id', playerId)
      .order('joined_at', { ascending: false })
      .limit(10);

    if (sessionsError) {
      throw sessionsError;
    }

    const formattedSessions = (recentSessions || []).map(sp => ({
      sessionId: sp.session_id,
      boxId: sp.sessions.box_id,
      universeLevel: sp.sessions.universe_level,
      status: sp.sessions.status,
      startingNn: sp.starting_nn,
      finalNn: sp.final_nn,
      color: sp.race,
      startedAt: sp.sessions.started_at,
      endedAt: sp.sessions.ended_at,
    }));

    // Count total games played
    const gamesPlayed = recentSessions?.length || 0;

    // Get favorite color (most used)
    const colorCounts = {};
    for (const sp of recentSessions || []) {
      if (sp.race) {
        colorCounts[sp.race] = (colorCounts[sp.race] || 0) + 1;
      }
    }
    const favoriteColor = Object.entries(colorCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

    return withCors(jsonResponse({
      player: {
        id: player.id,
        name: player.display_name,
        isGuest: player.is_guest,
        createdAt: player.created_at,
      },
      stats: {
        totalBestNn,
        highestLevel,
        levelsCompleted,
        gamesPlayed,
        globalRank,
        favoriteColor,
      },
      progress: (progress || []).map(p => ({
        level: p.universe_level,
        bestNn: p.best_nn,
        achievedAt: p.achieved_at,
      })),
      recentSessions: formattedSessions,
    }), env);
  } catch (error) {
    console.error('Player API error:', error);
    return withCors(errorResponse(error.message || 'Internal server error', 500), env);
  }
}