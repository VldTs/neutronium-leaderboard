/**
 * GET /api/auth/me
 * Get current authenticated user from cookie
 */

import { getCurrentPlayer } from '../../_shared/auth.js';
import { jsonResponse, errorResponse, handleCors, withCors } from '../../_shared/response.js';
import { createSupabaseClient } from '../../_shared/supabase.js';

export async function onRequestOptions(context) {
  return handleCors(context.env);
}

export async function onRequestGet(context) {
  const { request, env } = context;

  try {
    // Get player from auth cookie
    const player = await getCurrentPlayer(request, env);

    if (!player) {
      // Not authenticated - return unauthenticated response
      return withCors(
        jsonResponse({
          player: null,
          authenticated: false,
        }),
        env
      );
    }

    // Optionally fetch fresh player data from database
    const supabase = createSupabaseClient(env);
    const { data: dbPlayer, error } = await supabase
      .from('players')
      .select('id, display_name, email, is_guest, created_at')
      .eq('id', player.id)
      .single();

    if (error || !dbPlayer) {
      // Player not found in DB (deleted?) - return unauthenticated
      return withCors(
        jsonResponse({
          player: null,
          authenticated: false,
        }),
        env
      );
    }

    // Return authenticated player data
    return withCors(
      jsonResponse({
        player: {
          id: dbPlayer.id,
          displayName: dbPlayer.display_name,
          email: dbPlayer.email,
          isGuest: dbPlayer.is_guest,
          createdAt: dbPlayer.created_at,
        },
        authenticated: true,
      }),
      env
    );
  } catch (error) {
    console.error('Error in /api/auth/me:', error);
    return withCors(errorResponse('Internal server error', 500), env);
  }
}