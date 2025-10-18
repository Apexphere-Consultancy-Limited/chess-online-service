/**
 * Tests for player-ready Edge Function
 */

import { assertEquals, assertExists } from "https://deno.land/std@0.192.0/testing/asserts.ts"
import {
  supabase,
  createTestUser,
  deleteTestUser,
  callFunction,
  joinLobbySession,
  leaveLobbySession,
  deleteNotifications,
  type TestUser,
} from "../helpers/test-utils.ts"

async function createPendingChallenge(challengerToken: string, opponentId: string) {
  const { data } = await callFunction("create-challenge", {
    token: challengerToken,
    body: { challengedId: opponentId },
  })
  return data.challenge
}

async function acceptChallenge(opponentToken: string, challengeId: string) {
  const { data } = await callFunction("respond-to-challenge", {
    token: opponentToken,
    body: { challengeId, action: "accept" },
  })
  return data.game
}

Deno.test("player-ready: Creates game in waiting status with ready fields", async () => {
  let challenger: TestUser | null = null
  let opponent: TestUser | null = null
  let gameId: string | null = null

  try {
    challenger = await createTestUser("ready-challenger")
    opponent = await createTestUser("ready-opponent")

    await joinLobbySession(challenger, { lobbySlug: "main" })
    await joinLobbySession(opponent, { lobbySlug: "main" })

    const challenge = await createPendingChallenge(challenger.token, opponent.id)
    const game = await acceptChallenge(opponent.token, challenge.id)
    gameId = game.id

    // Verify game is in waiting status
    const { data: gameData } = await supabase
      .from("games")
      .select("status, white_ready, black_ready, ready_expires_at")
      .eq("id", gameId)
      .single()

    assertEquals(gameData?.status, "waiting")
    assertEquals(gameData?.white_ready, false)
    assertEquals(gameData?.black_ready, false)
    assertExists(gameData?.ready_expires_at)

    // Cleanup
    await supabase.from("challenges").delete().eq("id", challenge.id)
    await supabase.from("games").delete().eq("id", gameId)
  } finally {
    if (challenger) {
      await leaveLobbySession(challenger.id)
      await deleteTestUser(challenger.id)
    }
    if (opponent) {
      await leaveLobbySession(opponent.id)
      await deleteTestUser(opponent.id)
    }
  }
})

Deno.test("player-ready: First player marks ready successfully", async () => {
  let challenger: TestUser | null = null
  let opponent: TestUser | null = null
  let gameId: string | null = null

  try {
    challenger = await createTestUser("first-ready-challenger")
    opponent = await createTestUser("first-ready-opponent")

    await joinLobbySession(challenger, { lobbySlug: "main" })
    await joinLobbySession(opponent, { lobbySlug: "main" })
    await deleteNotifications(challenger.id)
    await deleteNotifications(opponent.id)

    const challenge = await createPendingChallenge(challenger.token, opponent.id)
    const game = await acceptChallenge(opponent.token, challenge.id)
    gameId = game.id

    // First player marks ready
    const { response, data } = await callFunction("player-ready", {
      token: challenger.token,
      body: { gameId },
    })

    assertEquals(response.status, 200)
    assertEquals(data.success, true)
    assertEquals(data.game.status, "waiting") // Still waiting for opponent
    assertEquals(data.game.bothReady, false)

    // Verify in database
    const { data: gameData } = await supabase
      .from("games")
      .select("status, white_ready, black_ready")
      .eq("id", gameId)
      .single()

    assertEquals(gameData?.status, "waiting")
    // One should be true, one false
    const readyCount = (gameData?.white_ready ? 1 : 0) + (gameData?.black_ready ? 1 : 0)
    assertEquals(readyCount, 1)

    // Verify opponent received notification
    await new Promise(resolve => setTimeout(resolve, 200))
    const { data: notifications } = await supabase
      .from("notifications")
      .select("type, payload")
      .eq("recipient_id", opponent.id)
      .eq("type", "player_ready")

    assertEquals(notifications?.length, 1)
    assertEquals(notifications?.[0].payload.gameId, gameId)
    assertExists(notifications?.[0].payload.playerUsername)

    // Cleanup
    await supabase.from("challenges").delete().eq("id", challenge.id)
    await supabase.from("games").delete().eq("id", gameId)
  } finally {
    if (challenger) {
      await leaveLobbySession(challenger.id)
      await deleteNotifications(challenger.id)
      await deleteTestUser(challenger.id)
    }
    if (opponent) {
      await leaveLobbySession(opponent.id)
      await deleteNotifications(opponent.id)
      await deleteTestUser(opponent.id)
    }
  }
})

Deno.test("player-ready: Both players ready starts the game", async () => {
  let challenger: TestUser | null = null
  let opponent: TestUser | null = null
  let gameId: string | null = null

  try {
    challenger = await createTestUser("both-ready-challenger")
    opponent = await createTestUser("both-ready-opponent")

    await joinLobbySession(challenger, { lobbySlug: "main" })
    await joinLobbySession(opponent, { lobbySlug: "main" })

    const challenge = await createPendingChallenge(challenger.token, opponent.id)
    const game = await acceptChallenge(opponent.token, challenge.id)
    gameId = game.id

    // First player marks ready
    await callFunction("player-ready", {
      token: challenger.token,
      body: { gameId },
    })

    // Second player marks ready
    const { response, data } = await callFunction("player-ready", {
      token: opponent.token,
      body: { gameId },
    })

    assertEquals(response.status, 200)
    assertEquals(data.success, true)
    assertEquals(data.game.status, "in_progress") // Game started!
    assertEquals(data.game.whiteReady, true)
    assertEquals(data.game.blackReady, true)
    assertEquals(data.game.bothReady, true)

    // Verify in database
    const { data: gameData } = await supabase
      .from("games")
      .select("status, white_ready, black_ready, started_at")
      .eq("id", gameId)
      .single()

    assertEquals(gameData?.status, "in_progress")
    assertEquals(gameData?.white_ready, true)
    assertEquals(gameData?.black_ready, true)
    assertExists(gameData?.started_at)

    // Cleanup
    await supabase.from("challenges").delete().eq("id", challenge.id)
    await supabase.from("games").delete().eq("id", gameId)
  } finally {
    if (challenger) {
      await leaveLobbySession(challenger.id)
      await deleteTestUser(challenger.id)
    }
    if (opponent) {
      await leaveLobbySession(opponent.id)
      await deleteTestUser(opponent.id)
    }
  }
})

Deno.test("player-ready: Rejects already ready player", async () => {
  let challenger: TestUser | null = null
  let opponent: TestUser | null = null
  let gameId: string | null = null

  try {
    challenger = await createTestUser("double-ready-challenger")
    opponent = await createTestUser("double-ready-opponent")

    await joinLobbySession(challenger, { lobbySlug: "main" })
    await joinLobbySession(opponent, { lobbySlug: "main" })

    const challenge = await createPendingChallenge(challenger.token, opponent.id)
    const game = await acceptChallenge(opponent.token, challenge.id)
    gameId = game.id

    // First ready
    await callFunction("player-ready", {
      token: challenger.token,
      body: { gameId },
    })

    // Try to ready again
    const { response, data } = await callFunction("player-ready", {
      token: challenger.token,
      body: { gameId },
    })

    assertEquals(response.status, 409)
    assertEquals(data.error, "You are already ready")

    // Cleanup
    await supabase.from("challenges").delete().eq("id", challenge.id)
    await supabase.from("games").delete().eq("id", gameId)
  } finally {
    if (challenger) {
      await leaveLobbySession(challenger.id)
      await deleteTestUser(challenger.id)
    }
    if (opponent) {
      await leaveLobbySession(opponent.id)
      await deleteTestUser(opponent.id)
    }
  }
})

Deno.test("player-ready: Rejects after timeout", async () => {
  let challenger: TestUser | null = null
  let opponent: TestUser | null = null
  let gameId: string | null = null

  try {
    challenger = await createTestUser("timeout-challenger")
    opponent = await createTestUser("timeout-opponent")

    await joinLobbySession(challenger, { lobbySlug: "main" })
    await joinLobbySession(opponent, { lobbySlug: "main" })

    const challenge = await createPendingChallenge(challenger.token, opponent.id)
    const game = await acceptChallenge(opponent.token, challenge.id)
    gameId = game.id

    // Manually set ready_expires_at to past
    await supabase
      .from("games")
      .update({ ready_expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq("id", gameId)

    // Try to ready after timeout
    const { response, data } = await callFunction("player-ready", {
      token: challenger.token,
      body: { gameId },
    })

    assertEquals(response.status, 410)
    assertEquals(data.error, "Ready period has expired")

    // Cleanup
    await supabase.from("challenges").delete().eq("id", challenge.id)
    await supabase.from("games").delete().eq("id", gameId)
  } finally {
    if (challenger) {
      await leaveLobbySession(challenger.id)
      await deleteTestUser(challenger.id)
    }
    if (opponent) {
      await leaveLobbySession(opponent.id)
      await deleteTestUser(opponent.id)
    }
  }
})

Deno.test("player-ready: Rejects non-waiting games", async () => {
  let challenger: TestUser | null = null
  let opponent: TestUser | null = null
  let gameId: string | null = null

  try {
    challenger = await createTestUser("non-waiting-challenger")
    opponent = await createTestUser("non-waiting-opponent")

    await joinLobbySession(challenger, { lobbySlug: "main" })
    await joinLobbySession(opponent, { lobbySlug: "main" })

    const challenge = await createPendingChallenge(challenger.token, opponent.id)
    const game = await acceptChallenge(opponent.token, challenge.id)
    gameId = game.id

    // Manually set status to in_progress
    await supabase
      .from("games")
      .update({ status: "in_progress" })
      .eq("id", gameId)

    // Try to ready after game started
    const { response, data } = await callFunction("player-ready", {
      token: challenger.token,
      body: { gameId },
    })

    assertEquals(response.status, 409)
    assertEquals(data.error, "Game is not in waiting status")

    // Cleanup
    await supabase.from("challenges").delete().eq("id", challenge.id)
    await supabase.from("games").delete().eq("id", gameId)
  } finally {
    if (challenger) {
      await leaveLobbySession(challenger.id)
      await deleteTestUser(challenger.id)
    }
    if (opponent) {
      await leaveLobbySession(opponent.id)
      await deleteTestUser(opponent.id)
    }
  }
})

Deno.test("player-ready: Rejects unauthenticated requests", async () => {
  const { response, data } = await callFunction("player-ready", {
    body: { gameId: "123e4567-e89b-12d3-a456-426614174000" },
  })

  assertEquals(response.status, 401)
  assertEquals(data?.msg?.includes("authorization") || data?.error === "Unauthorized", true)
})

Deno.test("player-ready: Rejects invalid gameId", async () => {
  let player: TestUser | null = null

  try {
    player = await createTestUser("invalid-gameid")

    const { response, data } = await callFunction("player-ready", {
      token: player.token,
      body: { gameId: "not-a-uuid" },
    })

    assertEquals(response.status, 400)
    assertEquals(data.error, "Invalid gameId format")
  } finally {
    if (player) await deleteTestUser(player.id)
  }
})
