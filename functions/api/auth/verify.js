import { createSupabaseClient } from '../../_shared/supabase.js';
import { createAuthToken, createAuthCookie } from '../../_shared/auth.js';

export async function onRequest(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  const returnUrl = url.searchParams.get('return_url');
  const appUrl = env.APP_URL || 'http://localhost:8788';

  // Helper to redirect with error
  const errorRedirect = (message) => {
    return Response.redirect(`${appUrl}/?auth_error=${encodeURIComponent(message)}`, 302);
  };

  // Validate return URL if provided (must be same origin)
  let validatedReturnUrl = null;
  if (returnUrl) {
    try {
      const appUrlObj = new URL(appUrl);
      const returnUrlObj = new URL(returnUrl);
      if (returnUrlObj.origin === appUrlObj.origin) {
        validatedReturnUrl = returnUrl;
      }
    } catch {
      // Invalid URL, ignore
    }
  }

  if (!token) {
    return errorRedirect('Invalid link');
  }

  if (!env.JWT_SECRET) {
    console.error('JWT_SECRET environment variable is not set');
    return errorRedirect('Server configuration error. Please contact support.');
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

    // FIRST: Check if email already has an existing account (with progress)
    // This takes priority over upgrading a guest player
    const { data: emailPlayer } = await supabase
      .from('players')
      .select('*')
      .eq('email', magicToken.email)
      .single();

    if (emailPlayer) {
      // Use the existing account - this player may have progress/levels unlocked
      player = emailPlayer;
      console.log('Using existing account for email:', magicToken.email, 'player_id:', player.id);
    }
    // SECOND: If no existing account for this email, check if we should upgrade a guest
    else if (magicToken.player_id) {
      const { data: guestPlayer, error: playerError } = await supabase
        .from('players')
        .select('*')
        .eq('id', magicToken.player_id)
        .single();

      if (!playerError && guestPlayer) {
        // Upgrade the guest player with email
        await supabase
          .from('players')
          .update({
            email: magicToken.email,
            is_guest: false,
          })
          .eq('id', guestPlayer.id);

        player = guestPlayer;
        player.is_guest = false;
        player.email = magicToken.email;
        console.log('Upgraded guest player:', player.id, 'with email:', magicToken.email);
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
    let authToken;
    try {
      authToken = await createAuthToken(player, env.JWT_SECRET);
    } catch (jwtError) {
      console.error('JWT creation failed:', jwtError.message);
      return errorRedirect('Authentication error. Please contact support.');
    }
    const cookie = createAuthCookie(authToken, env);

    console.log('Verify success - Player:', player.id, player.display_name);

    // Redirect to return URL (if valid) or profile page
    let redirectUrl;
    if (validatedReturnUrl) {
      // Add auth_success to return URL
      const returnUrlObj = new URL(validatedReturnUrl);
      returnUrlObj.searchParams.set('auth_success', '1');
      redirectUrl = returnUrlObj.toString();
    } else {
      redirectUrl = `${appUrl}/profile.html?auth_success=1`;
    }

    return new Response(null, {
      status: 302,
      headers: {
        'Location': redirectUrl,
        'Set-Cookie': cookie,
      },
    });
  } catch (error) {
    console.error('Verify error:', error.name, error.message, error.stack);
    return errorRedirect(`Something went wrong: ${error.message || 'Unknown error'}. Please try again.`);
  }
}