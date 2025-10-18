import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

interface ResignGameRequest {
  gameId?: string
}

serve(async (req) => {
  // 1. Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  // 2. Validate method
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  // 3. Check auth header
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
    // 4. Authenticate user
    const token = authHeader.replace("Bearer ", "")
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)

    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // 5. Parse request body
    let body: ResignGameRequest
    try {
      body = await req.json()
    } catch (_err) {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // 6. Validate gameId
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

    // 7. Fetch game and user profile in parallel (optimization)
    const [gameResult, profileResult] = await Promise.all([
      supabaseAdmin
        .from("games")
        .select("id, white_player_id, black_player_id, status, result, started_at")
        .eq("id", gameId)
        .single(),
      supabaseAdmin
        .from("profiles")
        .select("username")
        .eq("id", user.id)
        .single()
    ])

    const { data: game, error: gameError } = gameResult
    const { data: resigningProfile } = profileResult

    if (gameError || !game) {
      return new Response(JSON.stringify({ error: "Game not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // 8. Verify user is a player
    const isWhitePlayer = user.id === game.white_player_id
    const isBlackPlayer = user.id === game.black_player_id

    if (!isWhitePlayer && !isBlackPlayer) {
      return new Response(JSON.stringify({ error: "Not a player in this game" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // 9. Verify game is active
    if (game.status !== "waiting" && game.status !== "in_progress") {
      return new Response(JSON.stringify({ error: "Game already completed" }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // 10. Determine colors and result
    const resigningColor = isWhitePlayer ? "white" : "black"
    const result = resigningColor === "white" ? "black_win" : "white_win"
    const opponentId = isWhitePlayer ? game.black_player_id : game.white_player_id

    // 11. Update game (atomic)
    const { data: updatedGame, error: updateError } = await supabaseAdmin
      .from("games")
      .update({
        status: "completed",
        result: result,
        winner_id: opponentId,
        termination_type: "resignation",
        started_at: game.started_at ?? new Date().toISOString()
        // Note: completed_at is set automatically by handle_game_completion() trigger
      })
      .eq("id", gameId)
      .eq("status", game.status) // Prevent race conditions
      .select("id, status, result, winner_id, termination_type")
      .single()

    if (updateError || !updatedGame) {
      // Check if it's a race condition (no rows updated) vs actual error
      if (!updatedGame && !updateError) {
        return new Response(JSON.stringify({
          error: "Game state changed. Please retry."
        }), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }
      console.error("resign-game: database update error", updateError)
      return new Response(JSON.stringify({ error: "Failed to resign game" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // 12. Send notification to opponent (non-blocking)
    const { error: notificationError } = await supabaseAdmin
      .from("notifications")
      .insert({
        recipient_id: opponentId,
        type: "game_resigned",
        payload: {
          gameId: gameId,
          resignedBy: resigningColor,
          resignedByUsername: resigningProfile?.username ?? null,
          result: result,
        },
      })

    if (notificationError) {
      console.error("resign-game: failed to send notification", notificationError)
      // Don't fail the request - notification is non-critical
    }

    // 13. Return success
    return new Response(
      JSON.stringify({
        success: true,
        game: {
          id: updatedGame.id,
          status: updatedGame.status,
          result: updatedGame.result,
          winnerId: updatedGame.winner_id,
          terminationType: updatedGame.termination_type,
          resignedBy: resigningColor,
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    )
  } catch (error) {
    console.error("resign-game error:", error)
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
