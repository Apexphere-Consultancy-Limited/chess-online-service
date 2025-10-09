import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.192.0/testing/asserts.ts"
import {
  supabase,
  callFunction,
  createTestUser,
  deleteTestUser,
  joinLobbySession,
  leaveLobbySession,
  deleteNotifications,
} from "../helpers/test-utils.ts"

async function cleanupChallenge(challengeId: string) {
  await supabase.from("challenges").delete().eq("id", challengeId)
}

Deno.test("create-challenge: rejects unauthenticated requests", async () => {
  const { response } = await callFunction("create-challenge", {
    body: { challengedUsername: "someone" },
  })

  assertEquals(response.status, 401)
})

Deno.test("create-challenge: challenger must be in a lobby", async () => {
  const challenger = await createTestUser("no-lobby-challenger")
  const opponent = await createTestUser("no-lobby-opponent")

  try {
    const { response, data } = await callFunction("create-challenge", {
      token: challenger.token,
      body: { challengedId: opponent.id },
    })

    assertEquals(response.status, 409)
    assertEquals(data.error, "Join a lobby before challenging players")
  } finally {
    await deleteTestUser(challenger.id)
    await deleteTestUser(opponent.id)
  }
})

Deno.test("create-challenge: opponent must be in same lobby", async () => {
  const challenger = await createTestUser("cross-lobby-challenger")
  const opponent = await createTestUser("cross-lobby-opponent")

  try {
    await joinLobbySession(challenger, { lobbySlug: "main" })
    await joinLobbySession(opponent, { lobbySlug: "starter" })

    const { response, data } = await callFunction("create-challenge", {
      token: challenger.token,
      body: { challengedId: opponent.id },
    })

    assertEquals(response.status, 409)
    assertEquals(data.error, "Opponent is waiting in a different lobby")
  } finally {
    await leaveLobbySession(challenger.id)
    await leaveLobbySession(opponent.id)
    await deleteTestUser(challenger.id)
    await deleteTestUser(opponent.id)
  }
})

Deno.test("create-challenge: opponent must be available", async () => {
  const challenger = await createTestUser("busy-challenger")
  const opponent = await createTestUser("busy-opponent")

  try {
    await joinLobbySession(challenger, { lobbySlug: "main" })
    await joinLobbySession(opponent, { lobbySlug: "main", status: "in_game" })

    const { response, data } = await callFunction("create-challenge", {
      token: challenger.token,
      body: { challengedId: opponent.id },
    })

    assertEquals(response.status, 409)
    assertEquals(data.error, "Opponent is busy with another game")
  } finally {
    await leaveLobbySession(challenger.id)
    await leaveLobbySession(opponent.id)
    await deleteTestUser(challenger.id)
    await deleteTestUser(opponent.id)
  }
})

Deno.test("create-challenge: creates challenge when both available", async () => {
  const challenger = await createTestUser("challenge-success-1")
  const opponent = await createTestUser("challenge-success-2")

  try {
    await joinLobbySession(challenger, { lobbySlug: "main" })
    await joinLobbySession(opponent, { lobbySlug: "main" })
    await deleteNotifications(opponent.id)

    const { response, data } = await callFunction("create-challenge", {
      token: challenger.token,
      body: { challengedId: opponent.id, message: "Good luck!" },
    })

    assertEquals(response.status, 200)
    assertEquals(data.success, true)
    assertEquals(data.challenge.lobby.slug, "main")
    assertEquals(data.challenge.status, "pending")

    const { data: row } = await supabase
      .from("challenges")
      .select("id, lobby_id, challenger_id, challenged_id, status")
      .eq("id", data.challenge.id)
      .single()

    assertExists(row)
    assertEquals(row!.status, "pending")
    assertEquals(row!.challenger_id, challenger.id)
    assertEquals(row!.challenged_id, opponent.id)

    const { data: notifications } = await supabase
      .from("notifications")
      .select("type, payload")
      .eq("recipient_id", opponent.id)
      .eq("type", "challenge_received")

    assertEquals(notifications?.length ?? 0, 1)
    assertEquals(
      notifications?.[0].payload.challengeId,
      data.challenge.id,
    )
    assertEquals(notifications?.[0].payload.lobbySlug, "main")
    assertEquals(notifications?.[0].payload.challengerId, challenger.id)

    await cleanupChallenge(data.challenge.id)
  } finally {
    await deleteNotifications(opponent.id)
    await leaveLobbySession(challenger.id)
    await leaveLobbySession(opponent.id)
    await deleteTestUser(challenger.id)
    await deleteTestUser(opponent.id)
  }
})

Deno.test("create-challenge: prevents duplicate pending challenge", async () => {
  const challenger = await createTestUser("dup-challenger")
  const opponent = await createTestUser("dup-opponent")

  try {
    await joinLobbySession(challenger, { lobbySlug: "main" })
    await joinLobbySession(opponent, { lobbySlug: "main" })
    await deleteNotifications(opponent.id)

    const first = await callFunction("create-challenge", {
      token: challenger.token,
      body: { challengedId: opponent.id },
    })
    assertEquals(first.response.status, 200)

    const second = await callFunction("create-challenge", {
      token: challenger.token,
      body: { challengedId: opponent.id },
    })

    assertEquals(second.response.status, 409)
    assertEquals(
      second.data.error,
      "You already have a pending challenge for this player",
    )

    await cleanupChallenge(first.data.challenge.id)
  } finally {
    await deleteNotifications(opponent.id)
    await leaveLobbySession(challenger.id)
    await leaveLobbySession(opponent.id)
    await deleteTestUser(challenger.id)
    await deleteTestUser(opponent.id)
  }
})
