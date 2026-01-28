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
    const { sessionId, playerName, playerColor, playerId } = body;

    // Validate required fields
    if (!sessionId) {
      return withCors(errorResponse('sessionId is required'), env);
    }
    if (!playerName) {
      return withCors(errorResponse('playerName is required'), env);
    }

    // Validate color if provided
    const validColors = ['gray', 'pink', 'purple', 'green'];
    if (playerColor && !validColors.includes(playerColor)) {
      return withCors(errorResponse(`playerColor must be one of: ${validColors.join(', ')}`), env);
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

    // Get or create player
    let player;
    if (playerId) {
      // Try to find existing player
      const { data: existingPlayer } = await supabase
        .from('players')
        .select('*')
        .eq('id', playerId)
        .single();

      if (existingPlayer) {
        player = existingPlayer;
      } else {
        // Player ID provided but not found - create new player
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
      }
    } else {
      // No player ID - create guest player
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
    }

    // Check if player already in session
    const { data: existingEntry } = await supabase
      .from('session_players')
      .select('*')
      .eq('session_id', sessionId)
      .eq('player_id', player.id)
      .single();

    if (existingEntry) {
      // Player already in session - return success (allow rejoin)
      return withCors(jsonResponse({
        success: true,
        session,
        player,
        sessionPlayer: existingEntry,
        rejoined: true,
      }), env);
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

    return withCors(jsonResponse({
      success: true,
      session,
      player,
      sessionPlayer,
      rejoined: false,
    }), env);
  } catch (error) {
    console.error('Session join error:', error);
    return withCors(errorResponse(error.message || 'Internal server error', 500), env);
  }
}