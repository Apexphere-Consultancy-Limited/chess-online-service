import { assertEquals, assert } from "https://deno.land/std@0.192.0/testing/asserts.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import {
  supabase,
  supabaseUrl,
  supabaseAnonKey,
  createTestUser,
  deleteTestUser,
} from "../helpers/test-utils.ts"

function createAuthedClient(token: string) {
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
}

Deno.test("Lobbies: tables exist and seeded entries available", async () => {
  const { error: lobbiesError } = await supabase.from("lobbies").select("*").limit(0)
  assertEquals(lobbiesError, null, "lobbies table should exist")

  const { error: membersError } = await supabase.from("lobby_members").select("*").limit(0)
  assertEquals(membersError, null, "lobby_members table should exist")

  const { error: sessionsError } = await supabase
    .from("lobby_sessions")
    .select("*")
    .limit(0)
  assertEquals(sessionsError, null, "lobby_sessions table should exist")

  const { data: seeds, error: seedError } = await supabase
    .from("lobbies")
    .select("slug")
    .in("slug", ["starter", "main", "advanced"])

  assertEquals(seedError, null, "Seed query should succeed")
  assertEquals(new Set(seeds?.map((row) => row.slug)).size, 3, "Seed lobbies should exist")
})

Deno.test("Lobbies: private lobby visibility enforces membership", async () => {
  const user = await createTestUser("private-lobby")
  const slug = `private-${crypto.randomUUID().slice(0, 8)}`

  const { data: lobby } = await supabase
    .from("lobbies")
    .insert({
      slug,
      title: "Private Test Lobby",
      visibility: "private",
      description: "Temporary lobby for tests",
    })
    .select("id, slug")
    .single()

  const client = createAuthedClient(user.token)

  const { data: noAccess } = await client
    .from("lobbies")
    .select("id, slug")
    .eq("slug", slug)

  assertEquals(noAccess?.length ?? 0, 0, "Non-members should not see private lobby")

  await supabase.from("lobby_members").insert({
    lobby_id: lobby!.id,
    player_id: user.id,
    role: "member",
  })

  const { data: hasAccess } = await client
    .from("lobbies")
    .select("id, slug")
    .eq("slug", slug)

  assertEquals(hasAccess?.length ?? 0, 1, "Members should see private lobby")

  await client.removeAllChannels()
  await supabase.from("lobby_members").delete().eq("lobby_id", lobby!.id)
  await supabase.from("lobbies").delete().eq("id", lobby!.id)
  await deleteTestUser(user.id)
})

Deno.test("Lobby sessions: RLS enforces accessible lobbies", async () => {
  const user = await createTestUser("lobby-session")
  const client = createAuthedClient(user.token)

  const { data: starter } = await supabase
    .from("lobbies")
    .select("id")
    .eq("slug", "starter")
    .single()

  const insertPublic = await client
    .from("lobby_sessions")
    .upsert(
      {
        player_id: user.id,
        lobby_id: starter!.id,
        status: "available",
      },
      { onConflict: "player_id" },
    )
    .select("id")
    .single()

  assertEquals(insertPublic.error, null, "User should join public lobby")
  assert(insertPublic.data?.id, "Lobby session should be created")

  const slug = `private-${crypto.randomUUID().slice(0, 8)}`
  const { data: privateLobby } = await supabase
    .from("lobbies")
    .insert({
      slug,
      title: "Private Lobby Session Test",
      visibility: "private",
    })
    .select("id")
    .single()

  const insertPrivate = await client
    .from("lobby_sessions")
    .upsert(
      {
        player_id: user.id,
        lobby_id: privateLobby!.id,
        status: "available",
      },
      { onConflict: "player_id" },
    )
    .select("id")
    .single()

  assert(insertPrivate.error, "Non-member should be blocked from private lobby")

  await supabase.from("lobby_members").insert({
    lobby_id: privateLobby!.id,
    player_id: user.id,
    role: "member",
  })

  const insertPrivateAfterMembership = await client
    .from("lobby_sessions")
    .upsert(
      {
        player_id: user.id,
        lobby_id: privateLobby!.id,
        status: "available",
      },
      { onConflict: "player_id" },
    )
    .select("id")
    .single()

  assertEquals(insertPrivateAfterMembership.error, null, "Members should join private lobby")

  await client.removeAllChannels()
  await supabase.from("lobby_sessions").delete().eq("player_id", user.id)
  await supabase.from("lobby_members").delete().eq("lobby_id", privateLobby!.id)
  await supabase.from("lobbies").delete().eq("id", privateLobby!.id)
  await deleteTestUser(user.id)
})
