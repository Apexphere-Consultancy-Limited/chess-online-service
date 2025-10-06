import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { Chess } from 'https://esm.sh/chess.js@1.0.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface MoveRequest {
  gameId: string
  from: string
  to: string
  promotion?: string
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 1. Parse request
    const { gameId, from, to, promotion }: MoveRequest = await req.json()

    // 2. Authenticate user
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

    // 3. Fetch game state
    const { data: game, error: gameError } = await supabase
      .from('games')
      .select('*')
      .eq('id', gameId)
      .single()

    if (gameError || !game) {
      return new Response(JSON.stringify({ error: 'Game not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // 4. Verify player and turn
    const isWhitePlayer = user.id === game.white_player_id
    const isBlackPlayer = user.id === game.black_player_id

    if (!isWhitePlayer && !isBlackPlayer) {
      return new Response(JSON.stringify({ error: 'Not a player in this game' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const playerColor = isWhitePlayer ? 'white' : 'black'
    if (game.current_turn !== playerColor) {
      return new Response(JSON.stringify({ error: 'Not your turn' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (game.status !== 'in_progress' && game.status !== 'waiting') {
      return new Response(JSON.stringify({ error: 'Game is not active' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // 5. Validate move with chess.js
    const chess = new Chess(game.current_fen)
    let move

    try {
      move = chess.move({ from, to, promotion })
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Illegal move' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (!move) {
      return new Response(JSON.stringify({ error: 'Illegal move' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // 6. Determine game status
    let status = 'in_progress'
    let result = null
    let winnerId = null
    let terminationType = null

    if (chess.isCheckmate()) {
      status = 'completed'
      result = playerColor === 'white' ? 'white_win' : 'black_win'
      winnerId = user.id
      terminationType = 'checkmate'
    } else if (chess.isStalemate()) {
      status = 'completed'
      result = 'draw'
      terminationType = 'stalemate'
    } else if (chess.isDraw()) {
      status = 'completed'
      result = 'draw'
      terminationType = 'insufficient_material'
    }

    // 7. Get move number
    const { count } = await supabase
      .from('moves')
      .select('*', { count: 'exact', head: true })
      .eq('game_id', gameId)

    const moveNumber = (count ?? 0) + 1

    // 8. Update game state
    const { error: updateError } = await supabase
      .from('games')
      .update({
        current_fen: chess.fen(),
        current_turn: chess.turn() === 'w' ? 'white' : 'black',
        status,
        result,
        winner_id: winnerId,
        termination_type: terminationType,
        started_at: game.started_at ?? new Date().toISOString()
      })
      .eq('id', gameId)

    if (updateError) {
      throw new Error('Failed to update game: ' + updateError.message)
    }

    // 9. Insert move
    const { error: moveError } = await supabase
      .from('moves')
      .insert({
        game_id: gameId,
        player_id: user.id,
        move_number: moveNumber,
        from_square: from,
        to_square: to,
        piece: move.piece,
        captured_piece: move.captured,
        promotion: promotion,
        san_notation: move.san,
        fen_after: chess.fen()
      })

    if (moveError) {
      throw new Error('Failed to insert move: ' + moveError.message)
    }

    // 10. Return success
    return new Response(JSON.stringify({
      success: true,
      move: {
        from,
        to,
        san: move.san,
        fen: chess.fen()
      },
      gameStatus: status,
      result
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Error in validate-move:', error)
    return new Response(JSON.stringify({
      error: error.message || 'Internal server error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
