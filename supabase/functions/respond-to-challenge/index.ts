import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

type ChallengeAction = "accept" | "decline"

interface RespondChallengeRequest {
  challengeId: string
  action: ChallengeAction
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  try {
    const authHeader = req.headers.get("Authorization")
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    )

    const token = authHeader.replace("Bearer ", "")
    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(token)

    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const body = (await req.json()) as RespondChallengeRequest
    if (!body.challengeId || !body.action) {
      return new Response(JSON.stringify({ error: "Missing challengeId or action" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const action = body.action
    if (action !== "accept" && action !== "decline") {
      return new Response(JSON.stringify({ error: "Invalid action" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const {
      data: challenge,
      error: challengeError,
    } = await supabaseAdmin
      .from("challenges")
      .select(
        "id, status, challenger_id, challenged_id, lobby_id, expires_at, game_id"
      )
      .eq("id", body.challengeId)
      .single()

    if (challengeError || !challenge) {
      return new Response(JSON.stringify({ error: "Challenge not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    if (challenge.challenged_id !== user.id) {
      return new Response(JSON.stringify({ error: "Not authorized to respond to this challenge" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    if (challenge.status !== "pending") {
      return new Response(JSON.stringify({ error: `Challenge already ${challenge.status}` }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const { data: lobby, error: lobbyError } = await supabaseAdmin
      .from("lobbies")
      .select("id, slug, visibility")
      .eq("id", challenge.lobby_id)
      .single()

    if (lobbyError || !lobby) {
      return new Response(JSON.stringify({ error: "Lobby associated with challenge not found" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    if (lobby.visibility === "private") {
      const { count: membershipCount, error: membershipError } = await supabaseAdmin
        .from("lobby_members")
        .select("*", { count: "exact", head: true })
        .eq("lobby_id", lobby.id)
        .eq("player_id", user.id)

      if (membershipError) {
        throw membershipError
      }

      if ((membershipCount ?? 0) === 0) {
        return new Response(JSON.stringify({ error: "You are not a member of this private lobby" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }
    }

    const {
      data: challengedSession,
      error: challengedSessionError,
    } = await supabaseAdmin
      .from("lobby_sessions")
      .select("lobby_id, status")
      .eq("player_id", user.id)
      .single()

    if (challengedSessionError || !challengedSession) {
      return new Response(JSON.stringify({ error: "You are not currently in the lobby for this challenge" }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    if (challengedSession.lobby_id !== challenge.lobby_id) {
      return new Response(JSON.stringify({ error: "You left the lobby for this challenge" }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    if (challengedSession.status !== "available") {
      return new Response(JSON.stringify({ error: "You are currently busy with another game" }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const {
      data: challengerSession,
      error: challengerSessionError,
    } = await supabaseAdmin
      .from("lobby_sessions")
      .select("lobby_id, status")
      .eq("player_id", challenge.challenger_id)
      .single()

    if (challengerSessionError || !challengerSession) {
      return new Response(JSON.stringify({ error: "Challenger is not currently in the lobby" }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    if (challengerSession.lobby_id !== challenge.lobby_id) {
      return new Response(JSON.stringify({ error: "Challenger left the lobby" }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    if (challengerSession.status !== "available") {
      return new Response(JSON.stringify({ error: "Challenger is no longer available" }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    if (challenge.expires_at && new Date(challenge.expires_at) < new Date()) {
      await supabaseAdmin
        .from("challenges")
        .update({ status: "expired" })
        .eq("id", challenge.id)
        .eq("status", "pending")

      return new Response(JSON.stringify({ error: "Challenge has expired" }), {
        status: 410,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const { data: challengerProfile } = await supabaseAdmin
      .from("profiles")
      .select("username")
      .eq("id", challenge.challenger_id)
      .single()

    const { data: challengedProfile } = await supabaseAdmin
      .from("profiles")
      .select("username")
      .eq("id", challenge.challenged_id)
      .single()

    if (action === "decline") {
      const { data: updatedChallenge, error: updateError } = await supabaseAdmin
        .from("challenges")
        .update({ status: "declined" })
        .eq("id", challenge.id)
        .eq("status", "pending")
        .select("id")
        .single()

      if (updateError || !updatedChallenge) {
        throw updateError ?? new Error("Failed to decline challenge")
      }

      const { error: notificationError } = await supabaseAdmin
        .from("notifications")
        .insert({
          recipient_id: challenge.challenger_id,
          type: "challenge_declined",
          payload: {
            challengeId: challenge.id,
            opponentId: challenge.challenged_id,
            opponentUsername: challengedProfile?.username ?? null,
            lobbySlug: lobby.slug,
          },
        })

      if (notificationError) {
        console.error("Failed to notify challenger about decline:", notificationError)
      }

      return new Response(
        JSON.stringify({
          success: true,
          status: "declined",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // Accept flow
    const starterIsChallenger = Math.random() >= 0.5
    const whitePlayerId = starterIsChallenger ? challenge.challenger_id : challenge.challenged_id
    const blackPlayerId = starterIsChallenger ? challenge.challenged_id : challenge.challenger_id

    // Create game in 'waiting' status, ready_expires_at set to 60 seconds from now
    const readyExpiresAt = new Date(Date.now() + 60000).toISOString()

    const { data: game, error: gameError } = await supabaseAdmin
      .from("games")
      .insert({
        white_player_id: whitePlayerId,
        black_player_id: blackPlayerId,
        status: "waiting",
        current_turn: "white",
        ready_expires_at: readyExpiresAt,
        white_ready: false,
        black_ready: false,
      })
      .select("id, white_player_id, black_player_id")
      .single()

    if (gameError || !game) {
      throw gameError ?? new Error("Failed to create game for accepted challenge")
    }

    const { data: updatedChallenge, error: challengeUpdateError } = await supabaseAdmin
      .from("challenges")
      .update({
        status: "accepted",
        game_id: game.id,
      })
      .eq("id", challenge.id)
      .eq("status", "pending")
      .select("id")
      .single()

    if (challengeUpdateError || !updatedChallenge) {
      throw challengeUpdateError ?? new Error("Failed to update challenge status")
    }

    const lobbyUpserts = [
      {
        player_id: challenge.challenger_id,
        status: "in_game",
      },
      {
        player_id: challenge.challenged_id,
        status: "in_game",
      },
    ] satisfies Array<{ player_id: string; status: "in_game" }>

    const lobbyUpdateErrors = []
    for (const entry of lobbyUpserts) {
      const { error } = await supabaseAdmin
      .from("lobby_sessions")
      .upsert(
        {
          player_id: entry.player_id,
          status: entry.status,
          lobby_id: challenge.lobby_id,
          last_seen: new Date().toISOString(),
        },
        { onConflict: "player_id" }
      )

      if (error) {
        lobbyUpdateErrors.push(error)
      }
    }

    if (lobbyUpdateErrors.length > 0) {
      console.error("Lobby status updates failed:", lobbyUpdateErrors)
    }

    const challengerColor = game.white_player_id === challenge.challenger_id ? "white" : "black"
    const challengedColor = challengerColor === "white" ? "black" : "white"

    const notificationsPayload = [
      {
        recipient_id: challenge.challenger_id,
        type: "challenge_accepted",
        payload: {
          challengeId: challenge.id,
          gameId: game.id,
          opponentId: challenge.challenged_id,
          opponentUsername: challengedProfile?.username ?? null,
          lobbySlug: lobby.slug,
        },
      },
      {
        recipient_id: challenge.challenged_id,
        type: "challenge_accepted",
        payload: {
          challengeId: challenge.id,
          gameId: game.id,
          opponentId: challenge.challenger_id,
          opponentUsername: challengerProfile?.username ?? null,
          lobbySlug: lobby.slug,
        },
      },
      {
        recipient_id: challenge.challenger_id,
        type: "game_ready",
        payload: {
          gameId: game.id,
          color: challengerColor,
          lobbySlug: lobby.slug,
        },
      },
      {
        recipient_id: challenge.challenged_id,
        type: "game_ready",
        payload: {
          gameId: game.id,
          color: challengedColor,
          lobbySlug: lobby.slug,
        },
      },
    ]

    const { error: notifyError } = await supabaseAdmin
      .from("notifications")
      .insert(notificationsPayload)

    if (notifyError) {
      console.error("Failed to insert acceptance notifications:", notifyError)
    }

    return new Response(
      JSON.stringify({
        success: true,
        status: "accepted",
        game,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  } catch (error) {
    console.error("respond-to-challenge error:", error)
    return new Response(
      JSON.stringify({
        error: (error as { message?: string }).message ?? "Internal server error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    )
  }
})
