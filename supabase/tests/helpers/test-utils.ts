import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

export const supabaseUrl =
  Deno.env.get("SUPABASE_URL") || "http://127.0.0.1:54321"
export const supabaseServiceKey =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"
export const supabaseAnonKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"

export const supabase = createClient(supabaseUrl, supabaseServiceKey)

export interface TestUser {
  id: string
  email: string
  token: string
  username: string
}

export type LobbyStatus = "available" | "in_game"

interface CallFunctionOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE"
  body?: Record<string, unknown>
  token?: string
  useServiceKey?: boolean
  headers?: Record<string, string>
}

export async function callFunction(
  functionName: string,
  options: CallFunctionOptions = {},
): Promise<{ response: Response; data: any }> {
  const {
    method = "POST",
    body,
    token,
    useServiceKey,
    headers = {},
  } = options

  const requestHeaders: Record<string, string> = { ...headers }

  if (body && !("Content-Type" in requestHeaders)) {
    requestHeaders["Content-Type"] = "application/json"
  }

  if (useServiceKey) {
    requestHeaders["Authorization"] = `Bearer ${supabaseServiceKey}`
  } else if (token) {
    requestHeaders["Authorization"] = `Bearer ${token}`
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
    method,
    headers: requestHeaders,
    body: body ? JSON.stringify(body) : undefined,
  })

  const contentType = response.headers.get("content-type") ?? ""
  const data = contentType.includes("application/json")
    ? await response.json()
    : await response.text()

  return { response, data }
}

interface CreateTestUserOptions {
  eloRating?: number
}

export async function createTestUser(
  baseName: string,
  options: CreateTestUserOptions = {},
): Promise<TestUser> {
  const uniqueId = crypto.randomUUID().slice(0, 8)
  const username = `${baseName}-${uniqueId}`
  const email = `${username}@test.com`

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: "password123",
    email_confirm: true,
    user_metadata: { username },
  })

  if (error) {
    throw error
  }

  await new Promise((resolve) => setTimeout(resolve, 750))

  if (options.eloRating !== undefined) {
    await setUserElo(data.user.id, options.eloRating)
  }

  const authClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: signInData, error: signInError } =
    await authClient.auth.signInWithPassword({
      email,
      password: "password123",
    })

  await authClient.removeAllChannels()

  if (signInError) {
    throw signInError
  }

  return {
    id: data.user.id,
    email,
    token: signInData!.session!.access_token,
    username,
  }
}

export async function deleteTestUser(userId: string): Promise<void> {
  await supabase.auth.admin.deleteUser(userId)
}

export async function setUserElo(userId: string, rating: number): Promise<void> {
  await supabase
    .from("profiles")
    .update({ elo_rating: rating, updated_at: new Date().toISOString() })
    .eq("id", userId)
}

export async function getLobbyBySlug(slug: string) {
  return supabase.from("lobbies").select("*").eq("slug", slug).single()
}

export async function addLobbyMembership(
  lobbyId: string,
  playerId: string,
  role: "member" | "moderator" | "owner" = "member",
): Promise<void> {
  await supabase
    .from("lobby_members")
    .insert({ lobby_id: lobbyId, player_id: playerId, role })
}

export async function removeLobbyMembership(
  lobbyId: string,
  playerId: string,
): Promise<void> {
  await supabase
    .from("lobby_members")
    .delete()
    .eq("lobby_id", lobbyId)
    .eq("player_id", playerId)
}

export async function joinLobbySession(
  user: TestUser,
  options: { lobbySlug?: string; status?: LobbyStatus } = {},
) {
  const { lobbySlug, status = "available" } = options
  const { response, data } = await callFunction("upsert-lobby-session", {
    token: user.token,
    body: {
      status,
      ...(lobbySlug ? { lobbySlug } : {}),
    },
  })

  if (response.status !== 200) {
    throw new Error(
      `Failed to join lobby: ${response.status} ${JSON.stringify(data)}`,
    )
  }

  return data.session
}

export async function leaveLobbySession(userId: string): Promise<void> {
  await supabase.from("lobby_sessions").delete().eq("player_id", userId)
}

export async function getLobbySession(userId: string) {
  return supabase
    .from("lobby_sessions")
    .select("*")
    .eq("player_id", userId)
    .maybeSingle()
}

export async function createTestGame(
  creatorToken: string,
  opponentUsername: string,
): Promise<{ gameId: string; yourColor: string }> {
  const { data } = await callFunction("create-game", {
    token: creatorToken,
    body: { opponentUsername },
  })

  return {
    gameId: data.game.id,
    yourColor: data.game.yourColor,
  }
}

export async function cleanupTestGame(gameId: string): Promise<void> {
  await supabase.from("games").delete().eq("id", gameId)
}

export async function listNotifications(userId: string) {
  return supabase
    .from("notifications")
    .select("*")
    .eq("recipient_id", userId)
    .order("created_at", { ascending: false })
}

export async function deleteNotifications(userId: string) {
  await supabase.from("notifications").delete().eq("recipient_id", userId)
}
