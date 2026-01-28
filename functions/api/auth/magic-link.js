import { createSupabaseClient } from '../../_shared/supabase.js';
import { jsonResponse, errorResponse, handleCors, withCors } from '../../_shared/response.js';
import { generateToken, sendMagicLinkEmail } from '../../_shared/email.js';

const TOKEN_EXPIRY_MINUTES = 15;

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
    const { email, playerId } = body;

    // Validate email
    if (!email || !email.includes('@')) {
      return withCors(errorResponse('Valid email is required'), env);
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Generate magic token
    const token = generateToken(32);
    const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_MINUTES * 60 * 1000).toISOString();

    // Check if player already exists with this email
    const { data: existingPlayer } = await supabase
      .from('players')
      .select('id, display_name')
      .eq('email', normalizedEmail)
      .single();

    // Store the magic token
    const { error: tokenError } = await supabase
      .from('magic_tokens')
      .insert({
        email: normalizedEmail,
        token,
        player_id: playerId || existingPlayer?.id || null,
        expires_at: expiresAt,
      });

    if (tokenError) {
      console.error('Token insert error:', tokenError);
      throw new Error('Failed to create magic token');
    }

    // Send the magic link email
    try {
      await sendMagicLinkEmail(normalizedEmail, token, env);
    } catch (emailError) {
      console.error('Email send error:', emailError);

      // For development: show the magic link in console and return it (keep the token)
      if (env.APP_URL?.includes('localhost')) {
        const magicLink = `${env.APP_URL}/api/auth/verify?token=${token}`;
        console.log('DEV MODE - Magic link:', magicLink);
        return withCors(jsonResponse({
          success: true,
          message: 'Dev mode: Check console for magic link (email sending failed)',
          devLink: magicLink,
        }), env);
      }

      // Clean up the token if email fails in production
      await supabase
        .from('magic_tokens')
        .delete()
        .eq('token', token);

      throw new Error(`Failed to send email: ${emailError.message}`);
    }

    return withCors(jsonResponse({
      success: true,
      message: existingPlayer
        ? 'Check your email! A sign-in link has been sent.'
        : 'Check your email! A sign-in link has been sent to create your account.',
      existingAccount: !!existingPlayer,
    }), env);
  } catch (error) {
    console.error('Magic link error:', error);
    return withCors(errorResponse(error.message || 'Internal server error', 500), env);
  }
}