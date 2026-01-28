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
    const { boxId, universeLevel, playerName, playerColor, playerId } = body;

    // Validate required fields
    if (!boxId) {
      return withCors(errorResponse('boxId is required'), env);
    }
    if (!universeLevel || universeLevel < 1 || universeLevel > 13) {
      return withCors(errorResponse('universeLevel must be between 1 and 13'), env);
    }
    if (!playerName) {
      return withCors(errorResponse('playerName is required'), env);
    }

    // Validate color if provided
    const validColors = ['gray', 'pink', 'purple', 'green'];
    if (playerColor && !validColors.includes(playerColor)) {
      return withCors(errorResponse(`playerColor must be one of: ${validColors.join(', ')}`), env);
    }

    // Check if box exists, create if not
    const { data: existingBox } = await supabase
      .from('game_boxes')
      .select('box_id')
      .eq('box_id', boxId)
      .single();

    if (!existingBox) {
      const { error: boxError } = await supabase
        .from('game_boxes')
        .insert({ box_id: boxId });

      if (boxError) {
        throw boxError;
      }
    }

    // Check for existing active session
    const { data: existingSession } = await supabase
      .from('sessions')
      .select('id')
      .eq('box_id', boxId)
      .eq('status', 'active')
      .single();

    if (existingSession) {
      return withCors(errorResponse('Box already has an active session', 409), env);
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

    // Create the session
    const { data: session, error: sessionError } = await supabase
      .from('sessions')
      .insert({
        box_id: boxId,
        universe_level: universeLevel,
        host_player_id: player.id,
        status: 'active',
      })
      .select()
      .single();

    if (sessionError) {
      throw sessionError;
    }

    // Add host as first session player
    const { error: joinError } = await supabase
      .from('session_players')
      .insert({
        session_id: session.id,
        player_id: player.id,
        race: playerColor || null, // Store color in race field
      });

    if (joinError) {
      throw joinError;
    }

    return withCors(jsonResponse({
      success: true,
      session,
      player,
    }, 201), env);
  } catch (error) {
    console.error('Session create error:', error);
    return withCors(errorResponse(error.message || 'Internal server error', 500), env);
  }
}