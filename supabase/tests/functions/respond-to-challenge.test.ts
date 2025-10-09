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

async function createPendingChallenge(challengerToken: string, opponentId: string) {
  const { data } = await callFunction("create-challenge", {
    token: challengerToken,
    body: { challengedId: opponentId },
  })
  return data.challenge
}

async function cleanupChallenge(challengeId: string) {
  await supabase.from("challenges").delete().eq("id", challengeId)
}

async function cleanupGame(gameId: string) {
  await supabase.from("games").delete().eq("id", gameId)
}

Deno.test("respond-to-challenge: rejects unauthenticated requests", async () => {
  const challenger = await createTestUser("respond-unauth-challenger")
  const opponent = await createTestUser("respond-unauth-opponent")

  try {
    await joinLobbySession(challenger, { lobbySlug: "main" })
    await joinLobbySession(opponent, { lobbySlug: "main" })
    const challenge = await createPendingChallenge(challenger.token, opponent.id)

    const { response } = await callFunction("respond-to-challenge", {
      body: { challengeId: challenge.id, action: "accept" },
    })

    assertEquals(response.status, 401)

    await cleanupChallenge(challenge.id)
  } finally {
    await deleteNotifications(challenger.id)
    await deleteNotifications(opponent.id)
    await leaveLobbySession(challenger.id)
    await leaveLobbySession(opponent.id)
    await deleteTestUser(challenger.id)
    await deleteTestUser(opponent.id)
  }
})

Deno.test("respond-to-challenge: decline updates status and notifies challenger", async () => {
  const challenger = await createTestUser("decline-challenger")
  const opponent = await createTestUser("decline-opponent")

  try {
    await joinLobbySession(challenger, { lobbySlug: "main" })
    await joinLobbySession(opponent, { lobbySlug: "main" })
    await deleteNotifications(challenger.id)
    await deleteNotifications(opponent.id)

    const challenge = await createPendingChallenge(challenger.token, opponent.id)

    const { response, data } = await callFunction("respond-to-challenge", {
      token: opponent.token,
      body: { challengeId: challenge.id, action: "decline" },
    })

    assertEquals(response.status, 200)
    assertEquals(data.success, true)
    assertEquals(data.status, "declined")

    const { data: row } = await supabase
      .from("challenges")
      .select("status")
      .eq("id", challenge.id)
      .single()

    assertExists(row)
    assertEquals(row!.status, "declined")

    const { data: notifications } = await supabase
      .from("notifications")
      .select("type, payload")
      .eq("recipient_id", challenger.id)
      .eq("type", "challenge_declined")

    assertEquals(notifications?.length ?? 0, 1)
    assertEquals(notifications?.[0].payload.challengeId, challenge.id)

    await cleanupChallenge(challenge.id)
  } finally {
    await deleteNotifications(challenger.id)
    await deleteNotifications(opponent.id)
    await leaveLobbySession(challenger.id)
    await leaveLobbySession(opponent.id)
    await deleteTestUser(challenger.id)
    await deleteTestUser(opponent.id)
  }
})

Deno.test("respond-to-challenge: accept creates game and updates lobby", async () => {
  const challenger = await createTestUser("accept-challenger")
  const opponent = await createTestUser("accept-opponent")

  let gameId: string | null = null

  try {
    await joinLobbySession(challenger, { lobbySlug: "main" })
    await joinLobbySession(opponent, { lobbySlug: "main" })
    await deleteNotifications(challenger.id)
    await deleteNotifications(opponent.id)

    const challenge = await createPendingChallenge(challenger.token, opponent.id)

    const { response, data } = await callFunction("respond-to-challenge", {
      token: opponent.token,
      body: { challengeId: challenge.id, action: "accept" },
    })

    assertEquals(response.status, 200)
    assertEquals(data.success, true)
    assertEquals(data.status, "accepted")
    assertExists(data.game?.id)

    gameId = data.game.id

    const { data: challengeRow } = await supabase
      .from("challenges")
      .select("status, game_id")
      .eq("id", challenge.id)
      .single()

    assertEquals(challengeRow?.status, "accepted")
    assertEquals(challengeRow?.game_id, gameId)

    const { data: game } = await supabase
      .from("games")
      .select("white_player_id, black_player_id")
      .eq("id", gameId)
      .single()

    assertExists(game)

    const { data: challengerSession } = await supabase
      .from("lobby_sessions")
      .select("status")
      .eq("player_id", challenger.id)
      .single()
    const { data: opponentSession } = await supabase
      .from("lobby_sessions")
      .select("status")
      .eq("player_id", opponent.id)
      .single()

    assertEquals(challengerSession?.status, "in_game")
    assertEquals(opponentSession?.status, "in_game")

    const { data: challengerNotifications } = await supabase
      .from("notifications")
      .select("type, payload")
      .eq("recipient_id", challenger.id)
    const { data: opponentNotifications } = await supabase
      .from("notifications")
      .select("type, payload")
      .eq("recipient_id", opponent.id)

    const challengerTypes = new Set(
      (challengerNotifications ?? []).map((n) => n.type),
    )
    const opponentTypes = new Set(
      (opponentNotifications ?? []).map((n) => n.type),
    )

    assertEquals(challengerTypes.has("challenge_accepted"), true)
    assertEquals(challengerTypes.has("game_ready"), true)
    assertEquals(opponentTypes.has("challenge_accepted"), true)
    assertEquals(opponentTypes.has("game_ready"), true)

    const challengerGameReady = (challengerNotifications ?? []).find(
      (n) => n.type === "game_ready",
    )
    const opponentGameReady = (opponentNotifications ?? []).find(
      (n) => n.type === "game_ready",
    )

    assertEquals(challengerGameReady?.payload?.gameId, gameId)
    assertEquals(challengerGameReady?.payload?.lobbySlug, "main")
    assertEquals(opponentGameReady?.payload?.gameId, gameId)
    assertEquals(opponentGameReady?.payload?.lobbySlug, "main")

    await cleanupChallenge(challenge.id)
  } finally {
    if (gameId) await cleanupGame(gameId)
    await deleteNotifications(challenger.id)
    await deleteNotifications(opponent.id)
    await leaveLobbySession(challenger.id)
    await leaveLobbySession(opponent.id)
    await deleteTestUser(challenger.id)
    await deleteTestUser(opponent.id)
  }
})

Deno.test("respond-to-challenge: fails if challenger left lobby", async () => {
  const challenger = await createTestUser("left-lobby-challenger")
  const opponent = await createTestUser("left-lobby-opponent")

  try {
    await joinLobbySession(challenger, { lobbySlug: "main" })
    await joinLobbySession(opponent, { lobbySlug: "main" })
    await deleteNotifications(challenger.id)
    await deleteNotifications(opponent.id)

    const challenge = await createPendingChallenge(challenger.token, opponent.id)

    await leaveLobbySession(challenger.id)

    const { response, data } = await callFunction("respond-to-challenge", {
      token: opponent.token,
      body: { challengeId: challenge.id, action: "accept" },
    })

    assertEquals(response.status, 409)
    assertEquals(data.error, "Challenger is not currently in the lobby")

    await cleanupChallenge(challenge.id)
  } finally {
    await deleteNotifications(challenger.id)
    await deleteNotifications(opponent.id)
    await leaveLobbySession(opponent.id)
    await deleteTestUser(challenger.id)
    await deleteTestUser(opponent.id)
  }
})
