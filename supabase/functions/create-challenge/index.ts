import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

interface CreateChallengeRequest {
  challengedId?: string
  challengedUsername?: string
  message?: string
}

const LOBBY_SELECT_COLUMNS = "id, slug, title, visibility"

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

    const body = (await req.json()) as CreateChallengeRequest
    const rawMessage = body.message?.trim()
    const message = rawMessage ? rawMessage.slice(0, 280) : null

    let challengedId = body.challengedId
    if (!challengedId && body.challengedUsername) {
      const { data: profile, error: profileError } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("username", body.challengedUsername)
        .single()

      if (profileError || !profile) {
        return new Response(JSON.stringify({ error: "Opponent not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      challengedId = profile.id
    }

    if (!challengedId) {
      return new Response(JSON.stringify({ error: "Missing opponent identifier" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    if (challengedId === user.id) {
      return new Response(JSON.stringify({ error: "Cannot challenge yourself" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const {
      data: challengerSession,
      error: challengerSessionError,
    } = await supabaseAdmin
      .from("lobby_sessions")
      .select("lobby_id, status")
      .eq("player_id", user.id)
      .single()

    if (challengerSessionError || !challengerSession) {
      return new Response(JSON.stringify({ error: "Join a lobby before challenging players" }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    if (challengerSession.status !== "available") {
      return new Response(JSON.stringify({ error: "Finish your current game before sending new challenges" }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const { data: lobby, error: lobbyError } = await supabaseAdmin
      .from("lobbies")
      .select(LOBBY_SELECT_COLUMNS)
      .eq("id", challengerSession.lobby_id)
      .single()

    if (lobbyError || !lobby) {
      return new Response(JSON.stringify({ error: "Lobby not found for your session" }), {
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
      .eq("player_id", challengedId)
      .single()

    if (challengedSessionError || !challengedSession) {
      return new Response(
        JSON.stringify({ error: "Opponent is not currently in the lobby" }),
        {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    if (challengedSession.lobby_id !== lobby.id) {
      return new Response(
        JSON.stringify({ error: "Opponent is waiting in a different lobby" }),
        {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    if (challengedSession.status !== "available") {
      return new Response(
        JSON.stringify({ error: "Opponent is busy with another game" }),
        {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    const { count: existingCount, error: existingError } = await supabaseAdmin
      .from("challenges")
      .select("*", { count: "exact", head: true })
      .eq("challenger_id", user.id)
      .eq("challenged_id", challengedId)
      .eq("lobby_id", lobby.id)
      .eq("status", "pending")

    if (existingError) {
      throw existingError
    }

    if ((existingCount ?? 0) > 0) {
      return new Response(
        JSON.stringify({ error: "You already have a pending challenge for this player" }),
        {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString()

    const { data: challengerProfile, error: profileFetchError } = await supabaseAdmin
      .from("profiles")
      .select("username")
      .eq("id", user.id)
      .single()

    if (profileFetchError || !challengerProfile) {
      throw profileFetchError ?? new Error("Failed to load challenger profile")
    }

    const { data: challenge, error: insertError } = await supabaseAdmin
      .from("challenges")
      .insert({
        challenger_id: user.id,
        challenged_id: challengedId,
        lobby_id: lobby.id,
        message,
        expires_at: expiresAt,
      })
      .select(
        "id, status, challenger_id, challenged_id, lobby_id, message, expires_at, created_at"
      )
      .single()

    if (insertError || !challenge) {
      throw insertError ?? new Error("Failed to create challenge")
    }

    const { error: notificationError } = await supabaseAdmin.from("notifications").insert({
      recipient_id: challengedId,
      type: "challenge_received",
      payload: {
        challengeId: challenge.id,
        opponentId: user.id,
        opponentUsername: challengerProfile.username,
        lobbySlug: lobby.slug,
      },
    })

    if (notificationError) {
      console.error("Failed to insert notification for challenge:", notificationError)
    }

    return new Response(
      JSON.stringify({
        success: true,
        challenge: {
          ...challenge,
          lobby,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  } catch (error) {
    console.error("create-challenge error:", error)
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
