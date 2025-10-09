import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

interface CancelChallengeRequest {
  challengeId?: string
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

    let body: CancelChallengeRequest
    try {
      body = await req.json()
    } catch (_err) {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const challengeId = body.challengeId?.trim()
    if (!challengeId) {
      return new Response(JSON.stringify({ error: "challengeId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const {
      data: challenge,
      error: challengeError,
    } = await supabaseAdmin
      .from("challenges")
      .select("id, status, challenger_id, challenged_id, lobby_id")
      .eq("id", challengeId)
      .single()

    if (challengeError || !challenge) {
      return new Response(JSON.stringify({ error: "Challenge not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    if (challenge.challenger_id !== user.id) {
      return new Response(JSON.stringify({ error: "Not authorized to cancel this challenge" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    if (challenge.status !== "pending") {
      return new Response(
        JSON.stringify({ error: `Challenge already ${challenge.status}` }),
        {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      )
    }

    const {
      data: updatedChallenge,
      error: updateError,
    } = await supabaseAdmin
      .from("challenges")
      .update({ status: "cancelled" })
      .eq("id", challengeId)
      .eq("status", "pending")
      .select("id, lobby_id, challenged_id")
      .single()

    if (updateError || !updatedChallenge) {
      return new Response(
        JSON.stringify({ error: "Failed to cancel challenge" }),
        {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      )
    }

    const { data: lobby } = await supabaseAdmin
      .from("lobbies")
      .select("slug")
      .eq("id", updatedChallenge.lobby_id)
      .single()

    const { data: challengerProfile } = await supabaseAdmin
      .from("profiles")
      .select("username")
      .eq("id", user.id)
      .single()

    const { error: notificationError } = await supabaseAdmin
      .from("notifications")
      .insert({
        recipient_id: updatedChallenge.challenged_id,
        type: "challenge_cancelled",
        payload: {
          challengeId,
          lobbySlug: lobby?.slug ?? null,
          opponentId: user.id,
          opponentUsername: challengerProfile?.username ?? null,
        },
      })

    if (notificationError) {
      console.error("cancel-challenge: failed to insert notification", notificationError)
    }

    return new Response(
      JSON.stringify({
        success: true,
        status: "cancelled",
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    )
  } catch (error) {
    console.error("cancel-challenge error:", error)
    return new Response(
      JSON.stringify({ error: (error as { message?: string }).message ?? "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    )
  }
})
