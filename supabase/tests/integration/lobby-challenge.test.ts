import { assertEquals, assertExists } from "https://deno.land/std@0.192.0/testing/asserts.ts"
import {
  supabase,
  callFunction,
  createTestUser,
  deleteTestUser,
  joinLobbySession,
  leaveLobbySession,
  deleteNotifications,
} from "../helpers/test-utils.ts"

Deno.test("integration: lobby challenge flow", async () => {
  const challenger = await createTestUser("integration-challenger", { eloRating: 1300 })
  const opponent = await createTestUser("integration-opponent", { eloRating: 1350 })

  let challengeId: string | null = null
  let gameId: string | null = null

  try {
    await deleteNotifications(challenger.id)
    await deleteNotifications(opponent.id)

    await joinLobbySession(challenger, { lobbySlug: "main" })
    await joinLobbySession(opponent, { lobbySlug: "main" })

    const create = await callFunction("create-challenge", {
      token: challenger.token,
      body: { challengedId: opponent.id },
    })

    assertEquals(create.response.status, 200)
    assertEquals(create.data.success, true)
    challengeId = create.data.challenge.id

    const respond = await callFunction("respond-to-challenge", {
      token: opponent.token,
      body: { challengeId, action: "accept" },
    })

    assertEquals(respond.response.status, 200)
    assertEquals(respond.data.success, true)
    assertExists(respond.data.game?.id)
    gameId = respond.data.game.id

    const { data: challenge } = await supabase
      .from("challenges")
      .select("status, game_id")
      .eq("id", challengeId)
      .single()

    assertEquals(challenge?.status, "accepted")
    assertEquals(challenge?.game_id, gameId)

    const { data: game } = await supabase
      .from("games")
      .select("white_player_id, black_player_id, status")
      .eq("id", gameId)
      .single()

    assertExists(game)
    assertEquals(game!.status, "in_progress")

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

    const { data: challengerNotifs } = await supabase
      .from("notifications")
      .select("type, payload")
      .eq("recipient_id", challenger.id)
    const { data: opponentNotifs } = await supabase
      .from("notifications")
      .select("type, payload")
      .eq("recipient_id", opponent.id)

    const challengerTypes = new Set((challengerNotifs ?? []).map((n) => n.type))
    const opponentTypes = new Set((opponentNotifs ?? []).map((n) => n.type))

    assertEquals(challengerTypes.has("challenge_accepted"), true)
    assertEquals(challengerTypes.has("game_ready"), true)
    assertEquals(opponentTypes.has("challenge_received"), true)
    assertEquals(opponentTypes.has("challenge_accepted"), true)
    assertEquals(opponentTypes.has("game_ready"), true)
  } finally {
    if (challengeId) {
      await supabase.from("challenges").delete().eq("id", challengeId)
    }
    if (gameId) {
      await supabase.from("games").delete().eq("id", gameId)
    }
    await deleteNotifications(challenger.id)
    await deleteNotifications(opponent.id)
    await leaveLobbySession(challenger.id)
    await leaveLobbySession(opponent.id)
    await deleteTestUser(challenger.id)
    await deleteTestUser(opponent.id)
  }
})
