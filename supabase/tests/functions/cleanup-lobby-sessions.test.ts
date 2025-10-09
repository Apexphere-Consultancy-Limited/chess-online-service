import { assertEquals, assertExists } from "https://deno.land/std@0.192.0/testing/asserts.ts"
import {
  supabase,
  callFunction,
  createTestUser,
  deleteTestUser,
} from "../helpers/test-utils.ts"

Deno.test("cleanup-lobby-sessions: rejects without service key", async () => {
  const { response } = await callFunction("cleanup-lobby-sessions")

  assertEquals(response.status, 401)
})

Deno.test("cleanup-lobby-sessions: removes stale sessions and expires challenges", async () => {
  const challenger = await createTestUser("cleanup-challenger")
  const opponent = await createTestUser("cleanup-opponent")

  try {
    const { data: lobby } = await supabase
      .from("lobbies")
      .select("id")
      .eq("slug", "starter")
      .single()

    const staleTime = new Date(Date.now() - 5 * 60_000).toISOString()

    await supabase.from("lobby_sessions").upsert({
      player_id: challenger.id,
      lobby_id: lobby!.id,
      status: "available",
      last_seen: staleTime,
      created_at: staleTime,
    })

    const { data: challenge } = await supabase
      .from("challenges")
      .insert({
        challenger_id: challenger.id,
        challenged_id: opponent.id,
        lobby_id: lobby!.id,
        status: "pending",
        expires_at: new Date(Date.now() - 60_000).toISOString(),
      })
      .select("id")
      .single()

    const { response, data } = await callFunction("cleanup-lobby-sessions", {
      method: "POST",
      useServiceKey: true,
    })

    assertEquals(response.status, 200)
    assertEquals(data.success, true)

    const { data: session } = await supabase
      .from("lobby_sessions")
      .select("id")
      .eq("player_id", challenger.id)
      .maybeSingle()

    assertEquals(session, null)

    const { data: updatedChallenge } = await supabase
      .from("challenges")
      .select("status")
      .eq("id", challenge!.id)
      .single()

    assertExists(updatedChallenge)
    assertEquals(updatedChallenge!.status, "expired")

    await supabase.from("challenges").delete().eq("id", challenge!.id)
  } finally {
    await supabase.from("lobby_sessions").delete().eq("player_id", challenger.id)
    await deleteTestUser(challenger.id)
    await deleteTestUser(opponent.id)
  }
})
