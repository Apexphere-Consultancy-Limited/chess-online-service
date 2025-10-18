import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

interface PlayerReadyRequest {
  gameId?: string
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  // Validate method
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  // Check auth header
  const authHeader = req.headers.get("Authorization")
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  )

  try {
    // Authenticate user
    const token = authHeader.replace("Bearer ", "")
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)

    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // Parse request body
    let body: PlayerReadyRequest
    try {
      body = await req.json()
    } catch (_err) {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // Validate gameId
    const gameId = body.gameId?.trim()
    if (!gameId) {
      return new Response(JSON.stringify({ error: "gameId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // UUID validation
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(gameId)) {
      return new Response(JSON.stringify({ error: "Invalid gameId format" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // Fetch game and player profile in parallel
    const [gameResult, profileResult] = await Promise.all([
      supabaseAdmin
        .from("games")
        .select("id, white_player_id, black_player_id, status, white_ready, black_ready, ready_expires_at")
        .eq("id", gameId)
        .single(),
      supabaseAdmin
        .from("profiles")
        .select("username")
        .eq("id", user.id)
        .single()
    ])

    const { data: game, error: gameError } = gameResult
    const { data: playerProfile } = profileResult

    if (gameError || !game) {
      return new Response(JSON.stringify({ error: "Game not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // Verify user is a player
    const isWhitePlayer = user.id === game.white_player_id
    const isBlackPlayer = user.id === game.black_player_id

    if (!isWhitePlayer && !isBlackPlayer) {
      return new Response(JSON.stringify({ error: "Not a player in this game" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // Verify game is in waiting status
    if (game.status !== "waiting") {
      return new Response(JSON.stringify({ error: "Game is not in waiting status" }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // Check if ready period has expired
    if (game.ready_expires_at && new Date(game.ready_expires_at) < new Date()) {
      return new Response(JSON.stringify({ error: "Ready period has expired" }), {
        status: 410,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // Check if player is already ready
    const alreadyReady = isWhitePlayer ? game.white_ready : game.black_ready
    if (alreadyReady) {
      return new Response(JSON.stringify({ error: "You are already ready" }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // Determine opponent
    const opponentId = isWhitePlayer ? game.black_player_id : game.white_player_id
    const opponentReady = isWhitePlayer ? game.black_ready : game.white_ready

    // Update player's ready state
    const updateField = isWhitePlayer ? "white_ready" : "black_ready"
    const bothReady = opponentReady // If opponent is already ready, then after this update both will be ready

    const updateData: Record<string, unknown> = {
      [updateField]: true,
    }

    // If both players are ready, start the game
    if (bothReady) {
      updateData.status = "in_progress"
      updateData.started_at = new Date().toISOString()
    }

    const { data: updatedGame, error: updateError } = await supabaseAdmin
      .from("games")
      .update(updateData)
      .eq("id", gameId)
      .eq("status", "waiting") // Prevent race conditions
      .select("id, status, white_ready, black_ready")
      .single()

    if (updateError || !updatedGame) {
      // Check if it's a race condition
      if (!updatedGame && !updateError) {
        return new Response(JSON.stringify({
          error: "Game state changed. Please retry."
        }), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }
      console.error("player-ready: database update error", updateError)
      return new Response(JSON.stringify({ error: "Failed to update ready state" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // Send notification to opponent
    const { error: notificationError } = await supabaseAdmin
      .from("notifications")
      .insert({
        recipient_id: opponentId,
        type: "player_ready",
        payload: {
          gameId: gameId,
          playerUsername: playerProfile?.username ?? null,
        },
      })

    if (notificationError) {
      console.error("player-ready: failed to send notification", notificationError)
      // Don't fail the request - notification is non-critical
    }

    // Return success with current ready state
    return new Response(
      JSON.stringify({
        success: true,
        game: {
          id: updatedGame.id,
          status: updatedGame.status,
          whiteReady: updatedGame.white_ready,
          blackReady: updatedGame.black_ready,
          bothReady: updatedGame.white_ready && updatedGame.black_ready,
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    )
  } catch (error) {
    console.error("player-ready error:", error)
    return new Response(
      JSON.stringify({
        error: (error as { message?: string }).message ?? "Internal server error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    )
  }
})
