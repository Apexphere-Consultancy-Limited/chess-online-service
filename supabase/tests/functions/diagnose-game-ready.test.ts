/**
 * Diagnostic test to verify game_ready notifications are sent correctly
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

Deno.test("DIAGNOSTIC: Verify game_ready notification is sent to BOTH players", async () => {
  let challenger: TestUser | null = null
  let opponent: TestUser | null = null
  let gameId: string | null = null

  try {
    console.log("\n=== Creating test users ===")
    challenger = await createTestUser("diag-challenger")
    opponent = await createTestUser("diag-opponent")
    console.log(`Challenger ID: ${challenger.id}`)
    console.log(`Opponent ID: ${opponent.id}`)

    console.log("\n=== Joining lobby sessions ===")
    await joinLobbySession(challenger, { lobbySlug: "main" })
    await joinLobbySession(opponent, { lobbySlug: "main" })

    console.log("\n=== Clearing old notifications ===")
    await deleteNotifications(challenger.id)
    await deleteNotifications(opponent.id)

    console.log("\n=== Creating challenge ===")
    const challenge = await createPendingChallenge(challenger.token, opponent.id)
    console.log(`Challenge ID: ${challenge.id}`)

    console.log("\n=== Opponent accepting challenge ===")
    const { response, data } = await callFunction("respond-to-challenge", {
      token: opponent.token,
      body: { challengeId: challenge.id, action: "accept" },
    })

    console.log(`Response status: ${response.status}`)
    console.log(`Response data:`, JSON.stringify(data, null, 2))

    assertEquals(response.status, 200, "Should return 200 OK")
    assertEquals(data.success, true, "Should indicate success")
    assertExists(data.game?.id, "Should return game ID")

    gameId = data.game.id
    console.log(`\nGame created: ${gameId}`)

    // Wait a moment for notifications to be inserted
    await new Promise(resolve => setTimeout(resolve, 500))

    console.log("\n=== Checking CHALLENGER notifications ===")
    const { data: challengerNotifs, error: challengerError } = await supabase
      .from("notifications")
      .select("*")
      .eq("recipient_id", challenger.id)
      .order("created_at", { ascending: false })

    if (challengerError) {
      console.error("Error fetching challenger notifications:", challengerError)
    }

    console.log(`Found ${challengerNotifs?.length || 0} notifications for challenger`)
    challengerNotifs?.forEach((notif, i) => {
      console.log(`  [${i + 1}] Type: ${notif.type}, Payload:`, notif.payload)
    })

    console.log("\n=== Checking OPPONENT notifications ===")
    const { data: opponentNotifs, error: opponentError } = await supabase
      .from("notifications")
      .select("*")
      .eq("recipient_id", opponent.id)
      .order("created_at", { ascending: false })

    if (opponentError) {
      console.error("Error fetching opponent notifications:", opponentError)
    }

    console.log(`Found ${opponentNotifs?.length || 0} notifications for opponent`)
    opponentNotifs?.forEach((notif, i) => {
      console.log(`  [${i + 1}] Type: ${notif.type}, Payload:`, notif.payload)
    })

    // Verify notifications
    const challengerGameReady = challengerNotifs?.find(n => n.type === "game_ready")
    const opponentGameReady = opponentNotifs?.find(n => n.type === "game_ready")

    console.log("\n=== VERIFICATION ===")
    console.log(`Challenger has game_ready: ${!!challengerGameReady}`)
    console.log(`Opponent has game_ready: ${!!opponentGameReady}`)

    if (challengerGameReady) {
      console.log(`Challenger game_ready payload:`, challengerGameReady.payload)
    } else {
      console.error("❌ CHALLENGER DID NOT RECEIVE game_ready notification!")
    }

    if (opponentGameReady) {
      console.log(`Opponent game_ready payload:`, opponentGameReady.payload)
    } else {
      console.error("❌ OPPONENT DID NOT RECEIVE game_ready notification!")
    }

    // Assertions
    assertExists(challengerGameReady, "Challenger MUST receive game_ready notification")
    assertExists(opponentGameReady, "Opponent MUST receive game_ready notification")

    assertEquals(challengerGameReady.payload.gameId, gameId)
    assertEquals(opponentGameReady.payload.gameId, gameId)

    console.log("\n✅ BOTH PLAYERS RECEIVED game_ready NOTIFICATIONS")

    // Cleanup
    await supabase.from("challenges").delete().eq("id", challenge.id)
    if (gameId) await supabase.from("games").delete().eq("id", gameId)
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
