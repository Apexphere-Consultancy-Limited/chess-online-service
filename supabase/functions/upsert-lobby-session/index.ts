import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

type LobbyStatus = "available" | "in_game"

interface UpsertLobbyRequest {
  status?: LobbyStatus
  lobbySlug?: string
}

const LOBBY_SELECT_COLUMNS =
  "id, slug, title, description, visibility, min_elo, max_elo, time_control"

type LobbyRecord = {
  id: string
  slug: string
  title: string
  description: string | null
  visibility: "public" | "private"
  min_elo: number | null
  max_elo: number | null
  time_control: string | null
}

type LobbySessionPayload = {
  id: string
  lobby_id: string
  status: LobbyStatus
  last_seen: string
  created_at: string
  lobby: LobbyRecord
}

function isLobbyStatus(value: unknown): value is LobbyStatus {
  return value === "available" || value === "in_game"
}

function ratingDistance(lobby: LobbyRecord, rating: number): number {
  const min = lobby.min_elo ?? Number.NEGATIVE_INFINITY
  const max = lobby.max_elo ?? Number.POSITIVE_INFINITY
  if (rating >= min && rating <= max) {
    return 0
  }
  if (rating < min) {
    return min - rating
  }
  if (rating > max) {
    return rating - max
  }
  return Number.POSITIVE_INFINITY
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (!["POST", "PATCH", "DELETE"].includes(req.method)) {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  )

  try {
    const authHeader = req.headers.get("Authorization")
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

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

    if (req.method === "DELETE") {
      const { error: deleteError } = await supabaseAdmin
        .from("lobby_sessions")
        .delete()
        .eq("player_id", user.id)

      if (deleteError) {
        throw deleteError
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    let body: UpsertLobbyRequest = {}
    try {
      body = (await req.json()) as UpsertLobbyRequest
    } catch (_err) {
      // Ignore empty body; defaults will apply.
    }

    const status = body.status ?? "available"
    if (!isLobbyStatus(status)) {
      return new Response(JSON.stringify({ error: "Invalid status" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    let targetLobby: LobbyRecord | null = null
    if (body.lobbySlug) {
      const { data: lobby, error: lobbyError } = await supabaseAdmin
        .from("lobbies")
        .select(LOBBY_SELECT_COLUMNS)
        .eq("slug", body.lobbySlug)
        .single()

      if (lobbyError || !lobby) {
        return new Response(JSON.stringify({ error: "Lobby not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      if (lobby.visibility === "private") {
        const { count, error: membershipError } = await supabaseAdmin
          .from("lobby_members")
          .select("*", { count: "exact", head: true })
          .eq("lobby_id", lobby.id)
          .eq("player_id", user.id)

        if (membershipError) {
          throw membershipError
        }

        if ((count ?? 0) === 0) {
          return new Response(JSON.stringify({ error: "Lobby is private" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          })
        }
      }

      targetLobby = lobby as LobbyRecord
    } else {
      const {
        data: profile,
        error: profileError,
      } = await supabaseAdmin
        .from("profiles")
        .select("elo_rating")
        .eq("id", user.id)
        .single()

      if (profileError) {
        throw profileError
      }

      const rating = profile?.elo_rating ?? 1200
      const { data: lobbies, error: lobbiesError } = await supabaseAdmin
        .from("lobbies")
        .select(LOBBY_SELECT_COLUMNS)
        .eq("visibility", "public")
        .order("min_elo", { ascending: true, nullsFirst: true })

      if (lobbiesError) {
        throw lobbiesError
      }

      if (!lobbies || lobbies.length === 0) {
        return new Response(JSON.stringify({ error: "No public lobbies configured" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      const matching = lobbies.find((lobby) => ratingDistance(lobby as LobbyRecord, rating) === 0)
      if (matching) {
        targetLobby = matching as LobbyRecord
      } else {
        const sorted = lobbies
          .map((lobby) => lobby as LobbyRecord)
          .sort((a, b) => ratingDistance(a, rating) - ratingDistance(b, rating))
        targetLobby = sorted[0]
      }
    }

    if (!targetLobby) {
      return new Response(JSON.stringify({ error: "Unable to resolve lobby" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const now = new Date().toISOString()
    const { data: session, error: upsertError } = await supabaseAdmin
      .from("lobby_sessions")
      .upsert(
        {
          player_id: user.id,
          lobby_id: targetLobby.id,
          status,
          last_seen: now,
        },
        { onConflict: "player_id" }
      )
      .select(
        "id, lobby_id, status, last_seen, created_at, lobby:lobbies(id, slug, title, description, visibility, min_elo, max_elo, time_control)"
      )
      .single()

    if (upsertError || !session) {
      throw upsertError ?? new Error("Failed to upsert lobby session")
    }

    const lobbyData = Array.isArray(session.lobby) ? session.lobby[0] : session.lobby
    if (!lobbyData) {
      throw new Error("Failed to fetch lobby metadata")
    }

    const responsePayload: LobbySessionPayload = {
      id: session.id as string,
      lobby_id: session.lobby_id as string,
      status: session.status as LobbyStatus,
      last_seen: session.last_seen as string,
      created_at: session.created_at as string,
      lobby: lobbyData as LobbyRecord,
    }

    return new Response(
      JSON.stringify({
        success: true,
        session: responsePayload,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    )
  } catch (error) {
    console.error("upsert-lobby-session error:", error)
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
