/**
 * Tests for resign-game Edge Function
 */

import { assertEquals, assertExists } from "https://deno.land/std@0.192.0/testing/asserts.ts"
import {
  supabase,
  createTestUser,
  deleteTestUser,
  callFunction,
  createTestGame,
  cleanupTestGame,
  listNotifications,
  deleteNotifications,
  type TestUser,
} from "../helpers/test-utils.ts"

// ========================================
// Authentication Tests
// ========================================

Deno.test("resign-game: Rejects unauthenticated requests", async () => {
  const { response, data } = await callFunction("resign-game", {
    body: {
      gameId: "123e4567-e89b-12d3-a456-426614174000",
    },
  })

  assertEquals(response.status, 401, "Should return 401 Unauthorized")
  // Edge runtime returns {msg: "..."} for auth failures
  assertEquals(data?.msg?.includes("authorization") || data?.error === "Unauthorized", true)
})

Deno.test("resign-game: Rejects invalid auth token", async () => {
  const { response, data } = await callFunction("resign-game", {
    token: "invalid-token-xyz",
    body: {
      gameId: "123e4567-e89b-12d3-a456-426614174000",
    },
  })

  assertEquals(response.status, 401, "Should return 401 Unauthorized")
  // Edge runtime returns {msg: "Invalid JWT"} for invalid tokens
  assertEquals(data?.msg?.includes("JWT") || data?.error === "Unauthorized", true)
})

// ========================================
// Validation Tests
// ========================================

Deno.test("resign-game: Rejects missing gameId", async () => {
  let player: TestUser | null = null

  try {
    player = await createTestUser("no-game-id")

    const { response, data } = await callFunction("resign-game", {
      token: player.token,
      body: {},
    })

    assertEquals(response.status, 400, "Should return 400 Bad Request")
    assertEquals(data.error, "gameId is required")
  } finally {
    if (player) await deleteTestUser(player.id)
  }
})

Deno.test("resign-game: Rejects empty gameId", async () => {
  let player: TestUser | null = null

  try {
    player = await createTestUser("empty-game-id")

    const { response, data } = await callFunction("resign-game", {
      token: player.token,
      body: { gameId: "   " },
    })

    assertEquals(response.status, 400, "Should return 400 Bad Request")
    assertEquals(data.error, "gameId is required")
  } finally {
    if (player) await deleteTestUser(player.id)
  }
})

Deno.test("resign-game: Rejects invalid UUID format", async () => {
  let player: TestUser | null = null

  try {
    player = await createTestUser("invalid-uuid")

    const { response, data } = await callFunction("resign-game", {
      token: player.token,
      body: { gameId: "not-a-valid-uuid" },
    })

    assertEquals(response.status, 400, "Should return 400 Bad Request")
    assertEquals(data.error, "Invalid gameId format")
  } finally {
    if (player) await deleteTestUser(player.id)
  }
})

Deno.test("resign-game: Rejects invalid JSON body", async () => {
  let player: TestUser | null = null

  try {
    player = await createTestUser("invalid-json")

    const response = await fetch(`${Deno.env.get("SUPABASE_URL") || "http://127.0.0.1:54321"}/functions/v1/resign-game`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${player.token}`,
        "Content-Type": "application/json",
      },
      body: "invalid json {",
    })

    const data = await response.json()

    assertEquals(response.status, 400, "Should return 400 Bad Request")
    assertEquals(data.error, "Invalid JSON body")
  } finally {
    if (player) await deleteTestUser(player.id)
  }
})

// ========================================
// Authorization Tests
// ========================================

Deno.test("resign-game: Rejects non-existent game", async () => {
  let player: TestUser | null = null

  try {
    player = await createTestUser("nonexistent")

    const { response, data } = await callFunction("resign-game", {
      token: player.token,
      body: { gameId: "123e4567-e89b-12d3-a456-426614174000" },
    })

    assertEquals(response.status, 404, "Should return 404 Not Found")
    assertEquals(data.error, "Game not found")
  } finally {
    if (player) await deleteTestUser(player.id)
  }
})

Deno.test("resign-game: Rejects spectator resignation", async () => {
  let player1: TestUser | null = null
  let player2: TestUser | null = null
  let spectator: TestUser | null = null
  let gameId: string | null = null

  try {
    player1 = await createTestUser("player1")
    player2 = await createTestUser("player2")
    spectator = await createTestUser("spectator")

    const { gameId: gid } = await createTestGame(player1.token, player2.username)
    gameId = gid

    const { response, data } = await callFunction("resign-game", {
      token: spectator.token,
      body: { gameId },
    })

    assertEquals(response.status, 403, "Should return 403 Forbidden")
    assertEquals(data.error, "Not a player in this game")
  } finally {
    if (gameId) await cleanupTestGame(gameId)
    if (player1) await deleteTestUser(player1.id)
    if (player2) await deleteTestUser(player2.id)
    if (spectator) await deleteTestUser(spectator.id)
  }
})

// ========================================
// Game State Tests
// ========================================

Deno.test("resign-game: Rejects completed game", async () => {
  let player1: TestUser | null = null
  let player2: TestUser | null = null
  let gameId: string | null = null

  try {
    player1 = await createTestUser("completed1")
    player2 = await createTestUser("completed2")

    const { gameId: gid } = await createTestGame(player1.token, player2.username)
    gameId = gid

    // Mark game as completed
    await supabase
      .from("games")
      .update({ status: "completed", result: "white_win" })
      .eq("id", gameId)

    const { response, data } = await callFunction("resign-game", {
      token: player1.token,
      body: { gameId },
    })

    assertEquals(response.status, 409, "Should return 409 Conflict")
    assertEquals(data.error, "Game already completed")
  } finally {
    if (gameId) await cleanupTestGame(gameId)
    if (player1) await deleteTestUser(player1.id)
    if (player2) await deleteTestUser(player2.id)
  }
})

Deno.test("resign-game: Allows resignation from waiting game", async () => {
  let player1: TestUser | null = null
  let player2: TestUser | null = null
  let gameId: string | null = null

  try {
    player1 = await createTestUser("waiting1")
    player2 = await createTestUser("waiting2")

    const { gameId: gid } = await createTestGame(player1.token, player2.username)
    gameId = gid

    // Verify game is in waiting status
    const { data: gameBefore } = await supabase
      .from("games")
      .select("status")
      .eq("id", gameId)
      .single()
    assertEquals(gameBefore?.status, "waiting")

    const { response, data } = await callFunction("resign-game", {
      token: player1.token,
      body: { gameId },
    })

    assertEquals(response.status, 200, "Should return 200 OK")
    assertEquals(data.success, true)
    assertEquals(data.game.status, "completed")
  } finally {
    if (gameId) await cleanupTestGame(gameId)
    if (player1) await deleteTestUser(player1.id)
    if (player2) await deleteTestUser(player2.id)
  }
})

Deno.test("resign-game: Allows resignation from in_progress game", async () => {
  let player1: TestUser | null = null
  let player2: TestUser | null = null
  let gameId: string | null = null

  try {
    player1 = await createTestUser("progress1")
    player2 = await createTestUser("progress2")

    const { gameId: gid } = await createTestGame(player1.token, player2.username)
    gameId = gid

    // Set game to in_progress
    await supabase
      .from("games")
      .update({ status: "in_progress", started_at: new Date().toISOString() })
      .eq("id", gameId)

    const { response, data } = await callFunction("resign-game", {
      token: player1.token,
      body: { gameId },
    })

    assertEquals(response.status, 200, "Should return 200 OK")
    assertEquals(data.success, true)
    assertEquals(data.game.status, "completed")
  } finally {
    if (gameId) await cleanupTestGame(gameId)
    if (player1) await deleteTestUser(player1.id)
    if (player2) await deleteTestUser(player2.id)
  }
})

// ========================================
// Resignation Logic Tests
// ========================================

Deno.test("resign-game: White resignation results in black_win", async () => {
  let player1: TestUser | null = null
  let player2: TestUser | null = null
  let gameId: string | null = null

  try {
    player1 = await createTestUser("white-resigns")
    player2 = await createTestUser("black-wins")

    const { gameId: gid, yourColor } = await createTestGame(player1.token, player2.username)
    gameId = gid

    // Get actual player colors from database
    const { data: game } = await supabase
      .from("games")
      .select("white_player_id, black_player_id")
      .eq("id", gameId)
      .single()

    const whitePlayerId = game!.white_player_id
    const blackPlayerId = game!.black_player_id

    // Determine which player is white
    const whitePlayer = whitePlayerId === player1.id ? player1 : player2
    const blackPlayer = whitePlayerId === player1.id ? player2 : player1

    const { response, data } = await callFunction("resign-game", {
      token: whitePlayer.token,
      body: { gameId },
    })

    assertEquals(response.status, 200, "Should return 200 OK")
    assertEquals(data.success, true)
    assertEquals(data.game.result, "black_win")
    assertEquals(data.game.winnerId, blackPlayerId)
    assertEquals(data.game.resignedBy, "white")
    assertEquals(data.game.terminationType, "resignation")
  } finally {
    if (gameId) await cleanupTestGame(gameId)
    if (player1) await deleteTestUser(player1.id)
    if (player2) await deleteTestUser(player2.id)
  }
})

Deno.test("resign-game: Black resignation results in white_win", async () => {
  let player1: TestUser | null = null
  let player2: TestUser | null = null
  let gameId: string | null = null

  try {
    player1 = await createTestUser("black-resigns")
    player2 = await createTestUser("white-wins")

    const { gameId: gid } = await createTestGame(player1.token, player2.username)
    gameId = gid

    // Get actual player colors from database
    const { data: game } = await supabase
      .from("games")
      .select("white_player_id, black_player_id")
      .eq("id", gameId)
      .single()

    const whitePlayerId = game!.white_player_id
    const blackPlayerId = game!.black_player_id

    // Determine which player is black
    const blackPlayer = blackPlayerId === player1.id ? player1 : player2
    const whitePlayer = blackPlayerId === player1.id ? player2 : player1

    const { response, data } = await callFunction("resign-game", {
      token: blackPlayer.token,
      body: { gameId },
    })

    assertEquals(response.status, 200, "Should return 200 OK")
    assertEquals(data.success, true)
    assertEquals(data.game.result, "white_win")
    assertEquals(data.game.winnerId, whitePlayerId)
    assertEquals(data.game.resignedBy, "black")
    assertEquals(data.game.terminationType, "resignation")
  } finally {
    if (gameId) await cleanupTestGame(gameId)
    if (player1) await deleteTestUser(player1.id)
    if (player2) await deleteTestUser(player2.id)
  }
})

// ========================================
// Idempotency Tests
// ========================================

Deno.test("resign-game: Double resignation returns conflict", async () => {
  let player1: TestUser | null = null
  let player2: TestUser | null = null
  let gameId: string | null = null

  try {
    player1 = await createTestUser("double1")
    player2 = await createTestUser("double2")

    const { gameId: gid } = await createTestGame(player1.token, player2.username)
    gameId = gid

    // First resignation
    const { response: response1 } = await callFunction("resign-game", {
      token: player1.token,
      body: { gameId },
    })
    assertEquals(response1.status, 200, "First resignation should succeed")

    // Second resignation
    const { response: response2, data: data2 } = await callFunction("resign-game", {
      token: player1.token,
      body: { gameId },
    })
    assertEquals(response2.status, 409, "Second resignation should return 409")
    assertEquals(data2.error, "Game already completed")
  } finally {
    if (gameId) await cleanupTestGame(gameId)
    if (player1) await deleteTestUser(player1.id)
    if (player2) await deleteTestUser(player2.id)
  }
})

// ========================================
// Notification Tests
// ========================================

Deno.test("resign-game: Sends notification to opponent", async () => {
  let player1: TestUser | null = null
  let player2: TestUser | null = null
  let gameId: string | null = null

  try {
    player1 = await createTestUser("notif-sender")
    player2 = await createTestUser("notif-receiver")

    const { gameId: gid } = await createTestGame(player1.token, player2.username)
    gameId = gid

    // Clear existing notifications
    await deleteNotifications(player2.id)

    const { response } = await callFunction("resign-game", {
      token: player1.token,
      body: { gameId },
    })
    assertEquals(response.status, 200)

    // Wait a bit for notification to be created
    await new Promise(resolve => setTimeout(resolve, 100))

    // Check opponent received notification
    const { data: notifications } = await listNotifications(player2.id)

    assertExists(notifications, "Notifications should exist")
    assertEquals(notifications!.length, 1, "Should have exactly one notification")

    const notification = notifications![0]
    assertEquals(notification.type, "game_resigned")
    assertEquals(notification.payload.gameId, gameId)
    assertExists(notification.payload.resignedBy)
    assertExists(notification.payload.resignedByUsername)
    assertExists(notification.payload.result)

    // Cleanup notifications
    await deleteNotifications(player2.id)
  } finally {
    if (gameId) await cleanupTestGame(gameId)
    if (player1) await deleteTestUser(player1.id)
    if (player2) await deleteTestUser(player2.id)
  }
})

// ========================================
// Side Effects Tests
// ========================================

Deno.test("resign-game: Sets completed_at timestamp via trigger", async () => {
  let player1: TestUser | null = null
  let player2: TestUser | null = null
  let gameId: string | null = null

  try {
    player1 = await createTestUser("timestamp1")
    player2 = await createTestUser("timestamp2")

    const { gameId: gid } = await createTestGame(player1.token, player2.username)
    gameId = gid

    const { response } = await callFunction("resign-game", {
      token: player1.token,
      body: { gameId },
    })
    assertEquals(response.status, 200)

    // Check completed_at was set by trigger
    const { data: game } = await supabase
      .from("games")
      .select("completed_at")
      .eq("id", gameId)
      .single()

    assertExists(game?.completed_at, "completed_at should be set by trigger")
  } finally {
    if (gameId) await cleanupTestGame(gameId)
    if (player1) await deleteTestUser(player1.id)
    if (player2) await deleteTestUser(player2.id)
  }
})

Deno.test("resign-game: Updates player statistics via trigger", async () => {
  let player1: TestUser | null = null
  let player2: TestUser | null = null
  let gameId: string | null = null

  try {
    player1 = await createTestUser("stats-loser", { eloRating: 1500 })
    player2 = await createTestUser("stats-winner", { eloRating: 1500 })

    // Get initial stats
    const { data: profile1Before } = await supabase
      .from("profiles")
      .select("games_played, games_won, games_lost")
      .eq("id", player1.id)
      .single()

    const { data: profile2Before } = await supabase
      .from("profiles")
      .select("games_played, games_won, games_lost")
      .eq("id", player2.id)
      .single()

    const { gameId: gid } = await createTestGame(player1.token, player2.username)
    gameId = gid

    await callFunction("resign-game", {
      token: player1.token,
      body: { gameId },
    })

    // Wait for trigger to complete
    await new Promise(resolve => setTimeout(resolve, 200))

    // Check updated stats
    const { data: profile1After } = await supabase
      .from("profiles")
      .select("games_played, games_won, games_lost")
      .eq("id", player1.id)
      .single()

    const { data: profile2After } = await supabase
      .from("profiles")
      .select("games_played, games_won, games_lost")
      .eq("id", player2.id)
      .single()

    // Both should have games_played incremented
    assertEquals(
      profile1After!.games_played,
      profile1Before!.games_played + 1,
      "Player 1 games_played should increment"
    )
    assertEquals(
      profile2After!.games_played,
      profile2Before!.games_played + 1,
      "Player 2 games_played should increment"
    )

    // Player 1 (resigned) should have games_lost incremented
    assertEquals(
      profile1After!.games_lost,
      profile1Before!.games_lost + 1,
      "Resigning player should have games_lost incremented"
    )

    // Player 2 (won) should have games_won incremented
    assertEquals(
      profile2After!.games_won,
      profile2Before!.games_won + 1,
      "Winning player should have games_won incremented"
    )
  } finally {
    if (gameId) await cleanupTestGame(gameId)
    if (player1) await deleteTestUser(player1.id)
    if (player2) await deleteTestUser(player2.id)
  }
})

Deno.test("resign-game: Updates ELO ratings via trigger", async () => {
  let player1: TestUser | null = null
  let player2: TestUser | null = null
  let gameId: string | null = null

  try {
    player1 = await createTestUser("elo-loser", { eloRating: 1500 })
    player2 = await createTestUser("elo-winner", { eloRating: 1500 })

    // Get initial ELO
    const { data: profile1Before } = await supabase
      .from("profiles")
      .select("elo_rating")
      .eq("id", player1.id)
      .single()

    const { data: profile2Before } = await supabase
      .from("profiles")
      .select("elo_rating")
      .eq("id", player2.id)
      .single()

    const { gameId: gid } = await createTestGame(player1.token, player2.username)
    gameId = gid

    await callFunction("resign-game", {
      token: player1.token,
      body: { gameId },
    })

    // Wait for trigger to complete
    await new Promise(resolve => setTimeout(resolve, 200))

    // Check ELO changed
    const { data: profile1After } = await supabase
      .from("profiles")
      .select("elo_rating")
      .eq("id", player1.id)
      .single()

    const { data: profile2After } = await supabase
      .from("profiles")
      .select("elo_rating")
      .eq("id", player2.id)
      .single()

    // Loser should lose ELO
    assertEquals(
      profile1After!.elo_rating < profile1Before!.elo_rating,
      true,
      "Resigning player should lose ELO"
    )

    // Winner should gain ELO
    assertEquals(
      profile2After!.elo_rating > profile2Before!.elo_rating,
      true,
      "Winning player should gain ELO"
    )
  } finally {
    if (gameId) await cleanupTestGame(gameId)
    if (player1) await deleteTestUser(player1.id)
    if (player2) await deleteTestUser(player2.id)
  }
})

// ========================================
// Edge Cases
// ========================================

Deno.test("resign-game: Sets started_at if not already set", async () => {
  let player1: TestUser | null = null
  let player2: TestUser | null = null
  let gameId: string | null = null

  try {
    player1 = await createTestUser("started1")
    player2 = await createTestUser("started2")

    const { gameId: gid } = await createTestGame(player1.token, player2.username)
    gameId = gid

    // Verify started_at is null (resignation before first move)
    const { data: gameBefore } = await supabase
      .from("games")
      .select("started_at")
      .eq("id", gameId)
      .single()

    assertEquals(gameBefore?.started_at, null, "started_at should be null initially")

    await callFunction("resign-game", {
      token: player1.token,
      body: { gameId },
    })

    // Check started_at was set
    const { data: gameAfter } = await supabase
      .from("games")
      .select("started_at")
      .eq("id", gameId)
      .single()

    assertExists(gameAfter?.started_at, "started_at should be set after resignation")
  } finally {
    if (gameId) await cleanupTestGame(gameId)
    if (player1) await deleteTestUser(player1.id)
    if (player2) await deleteTestUser(player2.id)
  }
})

Deno.test("resign-game: Rejects METHOD not allowed", async () => {
  let player: TestUser | null = null

  try {
    player = await createTestUser("method-test")

    const { response, data } = await callFunction("resign-game", {
      method: "GET",
      token: player.token,
    })

    assertEquals(response.status, 405, "Should return 405 Method Not Allowed")
    assertEquals(data.error, "Method not allowed")
  } finally {
    if (player) await deleteTestUser(player.id)
  }
})
