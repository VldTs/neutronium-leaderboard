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
    const { sessionId, playerId, finalNn, color, startingNn } = body;

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

    // Validate color if provided
    const validColors = ['gray', 'pink', 'purple', 'green'];
    if (color && !validColors.includes(color)) {
      return withCors(errorResponse(`color must be one of: ${validColors.join(', ')}`), env);
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

    if (color) {
      updateData.race = color; // Store color in race field
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

    // Check if all players have submitted scores
    const { data: allPlayers, error: allPlayersError } = await supabase
      .from('session_players')
      .select('player_id, final_nn, race')
      .eq('session_id', sessionId);

    if (allPlayersError) {
      throw allPlayersError;
    }

    const allSubmitted = allPlayers.every(p => p.final_nn !== null);
    const submittedCount = allPlayers.filter(p => p.final_nn !== null).length;

    // If all players submitted, complete session and create next level
    if (allSubmitted && allPlayers.length > 0) {
      // Complete the session
      const { error: completeError } = await supabase
        .from('sessions')
        .update({
          status: 'completed',
          ended_at: new Date().toISOString(),
        })
        .eq('id', sessionId);

      if (completeError) {
        console.error('Failed to complete session:', completeError);
        throw completeError;
      }

      // Verify the session was completed
      const { data: verifiedSession } = await supabase
        .from('sessions')
        .select('status')
        .eq('id', sessionId)
        .single();

      // This should not happen, but handle it just in case
      if (verifiedSession?.status !== 'completed') {
        console.error('Session not completed after update, status:', verifiedSession?.status);
        throw new Error('Failed to complete session');
      }

      // We successfully completed the session - now update progress and create next
      // Update progress journal for each player
      for (const player of allPlayers) {
        // Check if player already has an entry for this level
        const { data: existingProgress } = await supabase
          .from('progress_journal')
          .select('*')
          .eq('player_id', player.player_id)
          .eq('universe_level', session.universe_level)
          .single();

        if (existingProgress) {
          // Update only if new score is better
          if (player.final_nn > existingProgress.best_nn) {
            await supabase
              .from('progress_journal')
              .update({
                best_nn: player.final_nn,
                achieved_at: new Date().toISOString(),
              })
              .eq('player_id', player.player_id)
              .eq('universe_level', session.universe_level);
          }
        } else {
          // Create new progress entry
          await supabase
            .from('progress_journal')
            .insert({
              player_id: player.player_id,
              universe_level: session.universe_level,
              best_nn: player.final_nn,
              achieved_at: new Date().toISOString(),
            });
        }
      }

      // Check if we can go to next level (max is 13)
      const nextLevel = session.universe_level + 1;
      let nextSession = null;

      if (nextLevel <= 13) {
        // Create next level session with same players
        const { data: newSession, error: newSessionError } = await supabase
          .from('sessions')
          .insert({
            box_id: session.box_id,
            universe_level: nextLevel,
            host_player_id: session.host_player_id,
            status: 'active',
          })
          .select()
          .single();

        if (newSessionError) {
          // If duplicate key error, another request already created the next session
          if (newSessionError.code === '23505') {
            // Retry to find the existing session
            for (let attempt = 0; attempt < 3; attempt++) {
              const { data: existingSession } = await supabase
                .from('sessions')
                .select('*')
                .eq('box_id', session.box_id)
                .eq('universe_level', nextLevel)
                .eq('status', 'active')
                .maybeSingle();

              if (existingSession) {
                nextSession = existingSession;
                break;
              }
              await new Promise(resolve => setTimeout(resolve, 100));
            }
          } else {
            throw newSessionError;
          }
        } else {
          nextSession = newSession;

          // Add all players to the new session with their colors
          for (const player of allPlayers) {
            await supabase
              .from('session_players')
              .insert({
                session_id: newSession.id,
                player_id: player.player_id,
                race: player.race, // Keep their color
              });
          }
        }
      }

      return withCors(jsonResponse({
        success: true,
        sessionPlayer: updatedPlayer,
        allSubmitted: true,
        submittedCount,
        totalPlayers: allPlayers.length,
        sessionCompleted: true,
        nextSession: nextSession ? {
          id: nextSession.id,
          universeLevel: nextSession.universe_level,
        } : null,
        message: nextSession
          ? `All scores submitted! Moving to Level ${nextLevel}`
          : 'All scores submitted! You completed all 13 levels!',
      }), env);
    }

    return withCors(jsonResponse({
      success: true,
      sessionPlayer: updatedPlayer,
      allSubmitted: false,
      submittedCount,
      totalPlayers: allPlayers.length,
      message: `Score submitted (${submittedCount}/${allPlayers.length} players)`,
    }), env);
  } catch (error) {
    console.error('Submit score error:', error);
    return withCors(errorResponse(error.message || 'Internal server error', 500), env);
  }
}