import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    const authHeader = req.headers.get("Authorization") ?? ""

    if (!serviceKey || authHeader !== `Bearer ${serviceKey}`) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      serviceKey
    )

    const cutoff = new Date(Date.now() - 60 * 1000).toISOString()

    const { count: lobbyRemoved, error: lobbyError } = await supabaseAdmin
      .from("lobby_sessions")
      .delete({ count: "exact" })
      .lt("last_seen", cutoff)

    if (lobbyError) {
      throw lobbyError
    }

    const now = new Date().toISOString()
    const { data: expiredChallenges, error: expireError } = await supabaseAdmin
      .from("challenges")
      .update({ status: "expired" })
      .eq("status", "pending")
      .lt("expires_at", now)
      .select("id")

    if (expireError) {
      throw expireError
    }

    return new Response(
      JSON.stringify({
        success: true,
        lobbySessionsRemoved: lobbyRemoved ?? 0,
        challengesExpired: expiredChallenges?.length ?? 0,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  } catch (error) {
    console.error("cleanup-lobby-sessions error:", error)
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
