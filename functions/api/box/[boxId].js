import { createSupabaseClient } from '../../_shared/supabase.js';
import { jsonResponse, errorResponse, handleCors, withCors } from '../../_shared/response.js';

export async function onRequest(context) {
  const { params, env, request } = context;
  const boxId = params.boxId;

  if (request.method === 'OPTIONS') {
    return handleCors(request, env);
  }

  try {
    const supabase = createSupabaseClient(env);

    if (request.method === 'GET') {
      return withCors(await handleGet(supabase, boxId), request, env);
    }

    if (request.method === 'POST') {
      const body = await request.json();
      return withCors(await handlePost(supabase, boxId, body), request, env);
    }

    return withCors(errorResponse('Method not allowed', 405), request, env);
  } catch (error) {
    console.error('Box API error:', error);
    return withCors(errorResponse(error.message || 'Internal server error', 500), request, env);
  }
}

async function handleGet(supabase, boxId) {
  // Check if box exists
  const { data: box, error: boxError } = await supabase
    .from('game_boxes')
    .select('box_id, registered_at, owner_player_id')
    .eq('box_id', boxId)
    .single();

  if (boxError && boxError.code !== 'PGRST116') {
    throw boxError;
  }

  // Check for active session
  const { data: activeSession, error: sessionError } = await supabase
    .from('sessions')
    .select('id, universe_level, status, started_at, host_player_id')
    .eq('box_id', boxId)
    .eq('status', 'active')
    .single();

  if (sessionError && sessionError.code !== 'PGRST116') {
    throw sessionError;
  }

  // If there's an active session, get taken colors
  let takenColors = [];
  let playerCount = 0;
  if (activeSession) {
    const { data: sessionPlayers, error: playersError } = await supabase
      .from('session_players')
      .select('race')
      .eq('session_id', activeSession.id);

    if (!playersError && sessionPlayers) {
      playerCount = sessionPlayers.length;
      takenColors = sessionPlayers
        .map(p => p.race)
        .filter(color => color !== null);
    }
  }

  return jsonResponse({
    boxId,
    registered: !!box,
    box: box || null,
    activeSession: activeSession ? {
      ...activeSession,
      playerCount,
      takenColors,
    } : null,
  });
}

async function handlePost(supabase, boxId, body) {
  const { email } = body;

  // Check if box already exists
  const { data: existingBox } = await supabase
    .from('game_boxes')
    .select('box_id')
    .eq('box_id', boxId)
    .single();

  if (existingBox) {
    return errorResponse('Box already registered', 409);
  }

  // Register the box
  const { data: newBox, error } = await supabase
    .from('game_boxes')
    .insert({
      box_id: boxId,
      registration_email: email || null,
    })
    .select()
    .single();

  if (error) {
    throw error;
  }

  return jsonResponse({
    success: true,
    box: newBox,
  }, 201);
}