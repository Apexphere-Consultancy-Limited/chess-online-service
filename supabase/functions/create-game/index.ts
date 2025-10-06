import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface CreateGameRequest {
  opponentUsername: string
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { opponentUsername }: CreateGameRequest = await req.json()

    // Authenticate
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const token = authHeader.replace('Bearer ', '')
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Find opponent by username
    const { data: opponent, error: opponentError } = await supabase
      .from('profiles')
      .select('id')
      .eq('username', opponentUsername)
      .single()

    if (opponentError || !opponent) {
      return new Response(JSON.stringify({ error: 'Opponent not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Check if trying to play against yourself
    if (opponent.id === user.id) {
      return new Response(JSON.stringify({ error: 'Cannot create game against yourself' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Randomly assign colors
    const isCreatorWhite = Math.random() > 0.5

    // Create game
    const { data: game, error: gameError } = await supabase
      .from('games')
      .insert({
        white_player_id: isCreatorWhite ? user.id : opponent.id,
        black_player_id: isCreatorWhite ? opponent.id : user.id,
        status: 'waiting'
      })
      .select()
      .single()

    if (gameError) {
      throw new Error('Failed to create game: ' + gameError.message)
    }

    return new Response(JSON.stringify({
      success: true,
      game: {
        id: game.id,
        yourColor: isCreatorWhite ? 'white' : 'black'
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Error in create-game:', error)
    return new Response(JSON.stringify({
      error: error.message || 'Internal server error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
