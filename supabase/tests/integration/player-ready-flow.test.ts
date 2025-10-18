/**
 * Integration test for complete player-ready flow
 * Tests the full journey from challenge acceptance to game start
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

Deno.test("INTEGRATION: Complete player-ready flow from challenge to game start", async () => {
  let playerA: TestUser | null = null
  let playerB: TestUser | null = null
  let challengeId: string | null = null
  let gameId: string | null = null

  try {
    console.log("\n=== STEP 1: Create two test users ===")
    playerA = await createTestUser("flow-player-a")
    playerB = await createTestUser("flow-player-b")
    console.log(`Player A ID: ${playerA.id}`)
    console.log(`Player B ID: ${playerB.id}`)

    console.log("\n=== STEP 2: Both players join lobby ===")
    await joinLobbySession(playerA, { lobbySlug: "main" })
    await joinLobbySession(playerB, { lobbySlug: "main" })
    console.log("✓ Both players in lobby")

    console.log("\n=== STEP 3: Clear notifications ===")
    await deleteNotifications(playerA.id)
    await deleteNotifications(playerB.id)

    console.log("\n=== STEP 4: Player A challenges Player B ===")
    const { data: challengeData } = await callFunction("create-challenge", {
      token: playerA.token,
      body: { challengedId: playerB.id },
    })
    challengeId = challengeData.challenge.id
    console.log(`Challenge created: ${challengeId}`)

    console.log("\n=== STEP 5: Player B accepts challenge ===")
    const { response: acceptResponse, data: acceptData } = await callFunction("respond-to-challenge", {
      token: playerB.token,
      body: { challengeId, action: "accept" },
    })

    assertEquals(acceptResponse.status, 200, "Accept should succeed")
    assertEquals(acceptData.success, true)
    assertExists(acceptData.game?.id)
    gameId = acceptData.game.id
    console.log(`Game created: ${gameId}`)

    console.log("\n=== STEP 6: Verify game is in 'waiting' status ===")
    const { data: gameAfterAccept } = await supabase
      .from("games")
      .select("status, white_ready, black_ready, ready_expires_at, white_player_id, black_player_id")
      .eq("id", gameId)
      .single()

    console.log(`Game status: ${gameAfterAccept?.status}`)
    console.log(`White ready: ${gameAfterAccept?.white_ready}`)
    console.log(`Black ready: ${gameAfterAccept?.black_ready}`)
    console.log(`Ready expires at: ${gameAfterAccept?.ready_expires_at}`)

    assertEquals(gameAfterAccept?.status, "waiting", "Game should be in waiting status")
    assertEquals(gameAfterAccept?.white_ready, false, "White should not be ready yet")
    assertEquals(gameAfterAccept?.black_ready, false, "Black should not be ready yet")
    assertExists(gameAfterAccept?.ready_expires_at, "Should have expiry timestamp")

    console.log("\n=== STEP 7: Verify both players received game_ready notifications ===")
    await new Promise(resolve => setTimeout(resolve, 300))

    const { data: playerANotifs } = await supabase
      .from("notifications")
      .select("type, payload")
      .eq("recipient_id", playerA.id)
      .order("created_at", { ascending: false })

    const { data: playerBNotifs } = await supabase
      .from("notifications")
      .select("type, payload")
      .eq("recipient_id", playerB.id)
      .order("created_at", { ascending: false })

    const playerAGameReady = playerANotifs?.find(n => n.type === "game_ready")
    const playerBGameReady = playerBNotifs?.find(n => n.type === "game_ready")

    assertExists(playerAGameReady, "Player A should receive game_ready notification")
    assertExists(playerBGameReady, "Player B should receive game_ready notification")
    assertEquals(playerAGameReady.payload.gameId, gameId)
    assertEquals(playerBGameReady.payload.gameId, gameId)
    console.log("✓ Both players received game_ready notifications")

    console.log("\n=== STEP 8: Player A clicks Ready ===")
    const { response: readyA, data: readyAData } = await callFunction("player-ready", {
      token: playerA.token,
      body: { gameId },
    })

    assertEquals(readyA.status, 200, "Player A ready should succeed")
    assertEquals(readyAData.success, true)
    assertEquals(readyAData.game.status, "waiting", "Game still waiting for Player B")
    assertEquals(readyAData.game.bothReady, false, "Not both ready yet")
    console.log(`Player A ready: status=${readyAData.game.status}, bothReady=${readyAData.game.bothReady}`)

    console.log("\n=== STEP 9: Verify Player B received player_ready notification ===")
    await new Promise(resolve => setTimeout(resolve, 300))

    const { data: playerBNotifsAfterA } = await supabase
      .from("notifications")
      .select("type, payload")
      .eq("recipient_id", playerB.id)
      .eq("type", "player_ready")

    assertEquals(playerBNotifsAfterA?.length, 1, "Player B should have 1 player_ready notification")
    assertEquals(playerBNotifsAfterA?.[0].payload.gameId, gameId)
    assertExists(playerBNotifsAfterA?.[0].payload.playerUsername, "Should have Player A's username")
    console.log(`✓ Player B received notification: ${playerBNotifsAfterA?.[0].payload.playerUsername} is ready`)

    console.log("\n=== STEP 10: Player B clicks Ready ===")
    const { response: readyB, data: readyBData } = await callFunction("player-ready", {
      token: playerB.token,
      body: { gameId },
    })

    assertEquals(readyB.status, 200, "Player B ready should succeed")
    assertEquals(readyBData.success, true)
    assertEquals(readyBData.game.status, "in_progress", "Game should now be in progress!")
    assertEquals(readyBData.game.whiteReady, true)
    assertEquals(readyBData.game.blackReady, true)
    assertEquals(readyBData.game.bothReady, true)
    console.log(`Player B ready: status=${readyBData.game.status}, bothReady=${readyBData.game.bothReady}`)

    console.log("\n=== STEP 11: Verify game started in database ===")
    const { data: finalGame } = await supabase
      .from("games")
      .select("status, white_ready, black_ready, started_at")
      .eq("id", gameId)
      .single()

    assertEquals(finalGame?.status, "in_progress", "Game status should be in_progress")
    assertEquals(finalGame?.white_ready, true, "White should be ready")
    assertEquals(finalGame?.black_ready, true, "Black should be ready")
    assertExists(finalGame?.started_at, "Game should have started_at timestamp")
    console.log(`✓ Game started at: ${finalGame?.started_at}`)

    console.log("\n=== STEP 12: Verify Player A received player_ready notification ===")
    await new Promise(resolve => setTimeout(resolve, 300))

    const { data: playerANotifsAfterB } = await supabase
      .from("notifications")
      .select("type, payload")
      .eq("recipient_id", playerA.id)
      .eq("type", "player_ready")

    assertEquals(playerANotifsAfterB?.length, 1, "Player A should have 1 player_ready notification")
    assertEquals(playerANotifsAfterB?.[0].payload.gameId, gameId)
    assertExists(playerANotifsAfterB?.[0].payload.playerUsername, "Should have Player B's username")
    console.log(`✓ Player A received notification: ${playerANotifsAfterB?.[0].payload.playerUsername} is ready`)

    console.log("\n✅ COMPLETE FLOW SUCCESSFUL!")
    console.log("Summary:")
    console.log("  1. Challenge created ✓")
    console.log("  2. Challenge accepted ✓")
    console.log("  3. Game created with status 'waiting' ✓")
    console.log("  4. Both players received game_ready notifications ✓")
    console.log("  5. Player A clicked ready ✓")
    console.log("  6. Player B received player_ready notification ✓")
    console.log("  7. Player B clicked ready ✓")
    console.log("  8. Game status changed to 'in_progress' ✓")
    console.log("  9. Player A received player_ready notification ✓")
    console.log("  10. Game started with timestamp ✓")

    // Cleanup
    if (challengeId) await supabase.from("challenges").delete().eq("id", challengeId)
    if (gameId) await supabase.from("games").delete().eq("id", gameId)
  } finally {
    if (playerA) {
      await leaveLobbySession(playerA.id)
      await deleteNotifications(playerA.id)
      await deleteTestUser(playerA.id)
    }
    if (playerB) {
      await leaveLobbySession(playerB.id)
      await deleteNotifications(playerB.id)
      await deleteTestUser(playerB.id)
    }
  }
})
