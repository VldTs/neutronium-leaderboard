import { createSupabaseClient } from '../../_shared/supabase.js';
import { createAuthToken, createAuthCookie } from '../../_shared/auth.js';

export async function onRequest(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  const appUrl = env.APP_URL || 'http://localhost:8788';

  // Helper to redirect with error
  const errorRedirect = (message) => {
    return Response.redirect(`${appUrl}/?auth_error=${encodeURIComponent(message)}`, 302);
  };

  if (!token) {
    return errorRedirect('Invalid link');
  }

  try {
    const supabase = createSupabaseClient(env);

    // Find the magic token
    const { data: magicToken, error: findError } = await supabase
      .from('magic_tokens')
      .select('*')
      .eq('token', token)
      .is('used_at', null)
      .single();

    if (findError || !magicToken) {
      console.log('Token lookup failed:', findError?.message || 'Token not found or already used');
      // Check if token exists but was used
      const { data: usedToken } = await supabase
        .from('magic_tokens')
        .select('used_at')
        .eq('token', token)
        .single();

      if (usedToken?.used_at) {
        return errorRedirect('This link has already been used. Please request a new one.');
      }
      return errorRedirect('Link is invalid. Please request a new one.');
    }

    // Check if expired
    if (new Date(magicToken.expires_at) < new Date()) {
      return errorRedirect('Link has expired. Please request a new one.');
    }

    // Mark token as used
    await supabase
      .from('magic_tokens')
      .update({ used_at: new Date().toISOString() })
      .eq('id', magicToken.id);

    let player;

    // If player_id was provided (upgrading guest), link to that player
    if (magicToken.player_id) {
      const { data: existingPlayer, error: playerError } = await supabase
        .from('players')
        .select('*')
        .eq('id', magicToken.player_id)
        .single();

      if (!playerError && existingPlayer) {
        // Update the player with email if not already set
        if (!existingPlayer.email) {
          await supabase
            .from('players')
            .update({
              email: magicToken.email,
              is_guest: false,
            })
            .eq('id', existingPlayer.id);
        }
        player = existingPlayer;
        player.is_guest = false;
      }
    }

    // If no player yet, check if email exists
    if (!player) {
      const { data: emailPlayer } = await supabase
        .from('players')
        .select('*')
        .eq('email', magicToken.email)
        .single();

      if (emailPlayer) {
        player = emailPlayer;
      }
    }

    // Create new player if needed
    if (!player) {
      const displayName = magicToken.email.split('@')[0];
      const { data: newPlayer, error: createError } = await supabase
        .from('players')
        .insert({
          email: magicToken.email,
          display_name: displayName,
          is_guest: false,
        })
        .select()
        .single();

      if (createError) {
        console.error('Create player error:', createError);
        return errorRedirect('Failed to create account');
      }

      player = newPlayer;
    }

    // Create JWT token
    const authToken = await createAuthToken(player, env.JWT_SECRET);
    const cookie = createAuthCookie(authToken, env);

    console.log('Verify success - Player:', player.id, player.display_name);
    console.log('Setting cookie:', cookie.substring(0, 50) + '...');

    // Redirect to profile with success
    return new Response(null, {
      status: 302,
      headers: {
        'Location': `${appUrl}/profile.html?auth_success=1`,
        'Set-Cookie': cookie,
      },
    });
  } catch (error) {
    console.error('Verify error:', error);
    return errorRedirect('Something went wrong. Please try again.');
  }
}