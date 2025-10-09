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

Deno.test("cancel-challenge: rejects unauthenticated requests", async () => {
  const { response } = await callFunction("cancel-challenge", {
    body: { challengeId: crypto.randomUUID() },
  })

  assertEquals(response.status, 401)
})

Deno.test("cancel-challenge: challenger can cancel pending challenge", async () => {
  const challenger = await createTestUser("cancel-own")
  const opponent = await createTestUser("cancel-target")

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
    const challengeId = create.data.challenge.id as string

    const cancel = await callFunction("cancel-challenge", {
      token: challenger.token,
      body: { challengeId },
    })

    assertEquals(cancel.response.status, 200)
    assertEquals(cancel.data.status, "cancelled")

    const { data: challengeRow } = await supabase
      .from("challenges")
      .select("status")
      .eq("id", challengeId)
      .single()

    assertExists(challengeRow)
    assertEquals(challengeRow!.status, "cancelled")

    const { data: notifications } = await supabase
      .from("notifications")
      .select("type, payload")
      .eq("recipient_id", opponent.id)
      .eq("type", "challenge_cancelled")

    assertEquals(notifications?.length ?? 0, 1)
    assertEquals(notifications?.[0].payload.challengeId, challengeId)
  } finally {
    await supabase.from("challenges").delete().eq("challenger_id", challenger.id)
    await deleteNotifications(challenger.id)
    await deleteNotifications(opponent.id)
    await leaveLobbySession(challenger.id)
    await leaveLobbySession(opponent.id)
    await deleteTestUser(challenger.id)
    await deleteTestUser(opponent.id)
  }
})

Deno.test("cancel-challenge: non-challenger cannot cancel", async () => {
  const challenger = await createTestUser("cancel-forbidden-challenger")
  const opponent = await createTestUser("cancel-forbidden-opponent")

  try {
    await joinLobbySession(challenger, { lobbySlug: "main" })
    await joinLobbySession(opponent, { lobbySlug: "main" })

    const create = await callFunction("create-challenge", {
      token: challenger.token,
      body: { challengedId: opponent.id },
    })

    assertEquals(create.response.status, 200)
    const challengeId = create.data.challenge.id as string

    const cancel = await callFunction("cancel-challenge", {
      token: opponent.token,
      body: { challengeId },
    })

    assertEquals(cancel.response.status, 403)
  } finally {
    await supabase.from("challenges").delete().eq("challenger_id", challenger.id)
    await leaveLobbySession(challenger.id)
    await leaveLobbySession(opponent.id)
    await deleteTestUser(challenger.id)
    await deleteTestUser(opponent.id)
  }
})

Deno.test("cancel-challenge: cannot cancel once challenge accepted", async () => {
  const challenger = await createTestUser("cancel-after-accept-challenger")
  const opponent = await createTestUser("cancel-after-accept-opponent")
  let acceptedGameId: string | undefined

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
    const challengeId = create.data.challenge.id as string

    const accept = await callFunction("respond-to-challenge", {
      token: opponent.token,
      body: { challengeId, action: "accept" },
    })

    assertEquals(accept.response.status, 200)
    acceptedGameId = accept.data.game?.id

    const cancel = await callFunction("cancel-challenge", {
      token: challenger.token,
      body: { challengeId },
    })

    assertEquals(cancel.response.status, 409)
  } finally {
    await supabase.from("challenges").delete().eq("challenger_id", challenger.id)
    if (acceptedGameId) {
      await supabase.from("games").delete().eq("id", acceptedGameId)
    }
    await deleteNotifications(challenger.id)
    await deleteNotifications(opponent.id)
    await leaveLobbySession(challenger.id)
    await leaveLobbySession(opponent.id)
    await deleteTestUser(challenger.id)
    await deleteTestUser(opponent.id)
  }
})
