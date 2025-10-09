import {
  assertEquals,
  assertExists,
  assert,
} from "https://deno.land/std@0.192.0/testing/asserts.ts"
import {
  supabase,
  callFunction,
  createTestUser,
  deleteTestUser,
  joinLobbySession,
  leaveLobbySession,
  addLobbyMembership,
  removeLobbyMembership,
} from "../helpers/test-utils.ts"

Deno.test("upsert-lobby-session: rejects unauthenticated requests", async () => {
  const { response } = await callFunction("upsert-lobby-session", {
    body: { status: "available" },
  })

  assertEquals(response.status, 401)
})

Deno.test("upsert-lobby-session: auto-places player by ELO", async () => {
  const user = await createTestUser("auto-lobby", { eloRating: 1600 })

  try {
    const session = await joinLobbySession(user)

    assertEquals(session.lobby.slug, "advanced")
    assertEquals(session.status, "available")

    const { data: row } = await supabase
      .from("lobby_sessions")
      .select("lobby_id, status")
      .eq("player_id", user.id)
      .single()

    assertExists(row)
    assertEquals(row!.status, "available")
  } finally {
    await leaveLobbySession(user.id)
    await deleteTestUser(user.id)
  }
})

Deno.test("upsert-lobby-session: auto-places low-ELO player into starter lobby", async () => {
  const user = await createTestUser("auto-lobby-low", { eloRating: 900 })

  try {
    const session = await joinLobbySession(user)

    assertEquals(session.lobby.slug, "starter")
    assertEquals(session.status, "available")

    const { data: row } = await supabase
      .from("lobby_sessions")
      .select("lobby_id")
      .eq("player_id", user.id)
      .single()

    assertExists(row)
  } finally {
    await leaveLobbySession(user.id)
    await deleteTestUser(user.id)
  }
})

Deno.test("upsert-lobby-session: accepts explicit lobby slug", async () => {
  const user = await createTestUser("explicit-lobby", { eloRating: 1100 })

  try {
    const session = await joinLobbySession(user, { lobbySlug: "starter" })

    assertEquals(session.lobby.slug, "starter")
  } finally {
    await leaveLobbySession(user.id)
    await deleteTestUser(user.id)
  }
})

Deno.test("upsert-lobby-session: enforces private lobby membership", async () => {
  const user = await createTestUser("private-lobby")
  const slug = `private-${crypto.randomUUID().slice(0, 8)}`
  const { data: lobby } = await supabase
    .from("lobbies")
    .insert({
      slug,
      title: "Private Test Lobby",
      visibility: "private",
    })
    .select("id, slug")
    .single()

  try {
    const attempt = await callFunction("upsert-lobby-session", {
      token: user.token,
      body: { lobbySlug: slug },
    })
    assertEquals(attempt.response.status, 403)
    assert(attempt.data.error.includes("private"))

    await addLobbyMembership(lobby!.id, user.id)

    const success = await callFunction("upsert-lobby-session", {
      token: user.token,
      body: { lobbySlug: slug },
    })

    assertEquals(success.response.status, 200)
    assertEquals(success.data.session.lobby.slug, slug)
  } finally {
    await leaveLobbySession(user.id)
    await removeLobbyMembership(lobby!.id, user.id)
    await supabase.from("lobbies").delete().eq("id", lobby!.id)
    await deleteTestUser(user.id)
  }
})

Deno.test("upsert-lobby-session: DELETE removes session", async () => {
  const user = await createTestUser("delete-lobby", { eloRating: 1250 })

  try {
    await joinLobbySession(user, { lobbySlug: "main" })

    const { response, data } = await callFunction("upsert-lobby-session", {
      method: "DELETE",
      token: user.token,
    })

    assertEquals(response.status, 200)
    assertEquals(data.success, true)

    const { data: session } = await supabase
      .from("lobby_sessions")
      .select("id")
      .eq("player_id", user.id)
      .maybeSingle()

    assertEquals(session, null)
  } finally {
    await leaveLobbySession(user.id)
    await deleteTestUser(user.id)
  }
})
