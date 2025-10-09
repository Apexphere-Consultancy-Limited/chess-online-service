import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

interface MarkNotificationRequest {
  notificationIds?: string[]
  markAll?: boolean
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

    const body = (await req.json()) as MarkNotificationRequest
    const readAt = new Date().toISOString()
    let updatedCount = 0

    if (body.markAll) {
      const { data, error } = await supabaseAdmin
        .from("notifications")
        .update({ read_at: readAt })
        .eq("recipient_id", user.id)
        .is("read_at", null)
        .select("id")

      if (error) {
        throw error
      }

      updatedCount = data?.length ?? 0
    } else if (body.notificationIds && body.notificationIds.length > 0) {
      const { data, error } = await supabaseAdmin
        .from("notifications")
        .update({ read_at: readAt })
        .eq("recipient_id", user.id)
        .in("id", body.notificationIds)
        .select("id")

      if (error) {
        throw error
      }

      updatedCount = data?.length ?? 0
    } else {
      return new Response(JSON.stringify({ error: "No notification ids provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    return new Response(
      JSON.stringify({
        success: true,
        updatedCount,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  } catch (error) {
    console.error("mark-notification-read error:", error)
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
