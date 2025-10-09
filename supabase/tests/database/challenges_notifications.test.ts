import { assertEquals } from "https://deno.land/std@0.192.0/testing/asserts.ts"
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

Deno.test("Challenges: table exists and requires lobby_id", async () => {
  const { error } = await supabase.from("challenges").select("*").limit(0)
  assertEquals(error, null, "challenges table should exist")

  const challenger = await createTestUser("challenger")
  const opponent = await createTestUser("opponent")

  const { data: lobby } = await supabase
    .from("lobbies")
    .select("id")
    .eq("slug", "starter")
    .single()

  const insertMissingLobby = await supabase
    .from("challenges")
    .insert({
      challenger_id: challenger.id,
      challenged_id: opponent.id,
      status: "pending",
    })
    .select("id")
    .single()

  assertEquals(
    insertMissingLobby.error?.code,
    "23502",
    "Missing lobby_id should violate NOT NULL constraint",
  )

  const { data: challenge } = await supabase
    .from("challenges")
    .insert({
      challenger_id: challenger.id,
      challenged_id: opponent.id,
      lobby_id: lobby!.id,
      status: "pending",
    })
    .select("id, lobby_id")
    .single()

  assertEquals(challenge?.lobby_id, lobby!.id)

  const { error: cancelError } = await supabase
    .from("challenges")
    .update({ status: "cancelled" })
    .eq("id", challenge!.id)

  assertEquals(cancelError, null, "Should allow updating status to cancelled")

  await supabase.from("challenges").delete().eq("id", challenge!.id)
  await deleteTestUser(challenger.id)
  await deleteTestUser(opponent.id)
})

Deno.test("Challenges: RLS restricts visibility to participants", async () => {
  const challenger = await createTestUser("challenger-sees")
  const opponent = await createTestUser("opponent-sees")
  const outsider = await createTestUser("outsider")

  const { data: lobby } = await supabase
    .from("lobbies")
    .select("id")
    .eq("slug", "starter")
    .single()

  const { data: challenge } = await supabase
    .from("challenges")
    .insert({
      challenger_id: challenger.id,
      challenged_id: opponent.id,
      lobby_id: lobby!.id,
      status: "pending",
    })
    .select("id")
    .single()

  const challengerClient = createAuthedClient(challenger.token)
  const { data: challengerView } = await challengerClient
    .from("challenges")
    .select("id")
    .eq("id", challenge!.id)
  assertEquals(challengerView?.length ?? 0, 1, "Challenger should see the challenge")

  const opponentClient = createAuthedClient(opponent.token)
  const { data: opponentView } = await opponentClient
    .from("challenges")
    .select("id")
    .eq("id", challenge!.id)
  assertEquals(opponentView?.length ?? 0, 1, "Opponent should see the challenge")

  const outsiderClient = createAuthedClient(outsider.token)
  const { data: outsiderView } = await outsiderClient
    .from("challenges")
    .select("id")
    .eq("id", challenge!.id)
  assertEquals(outsiderView?.length ?? 0, 0, "Outsider should not see the challenge")

  await challengerClient.removeAllChannels()
  await opponentClient.removeAllChannels()
  await outsiderClient.removeAllChannels()

  await supabase.from("challenges").delete().eq("id", challenge!.id)
  await deleteTestUser(challenger.id)
  await deleteTestUser(opponent.id)
  await deleteTestUser(outsider.id)
})

Deno.test("Notifications: row exists and recipient-only visibility", async () => {
  const user = await createTestUser("notify-user")
  const outsider = await createTestUser("notify-outsider")

  const { error } = await supabase.from("notifications").select("*").limit(0)
  assertEquals(error, null, "notifications table should exist")

  const { data: notification } = await supabase
    .from("notifications")
    .insert({
      recipient_id: user.id,
      type: "challenge_received",
      payload: { example: "payload" },
    })
    .select("id")
    .single()

  const recipientClient = createAuthedClient(user.token)
  const { data: recipientView } = await recipientClient
    .from("notifications")
    .select("id")
    .eq("id", notification!.id)
  assertEquals(recipientView?.length ?? 0, 1, "Recipient should see notification")

  const outsiderClient = createAuthedClient(outsider.token)
  const { data: outsiderView } = await outsiderClient
    .from("notifications")
    .select("id")
    .eq("id", notification!.id)
  assertEquals(outsiderView?.length ?? 0, 0, "Non-recipient should not see notification")

  const { error: cancelledInsertError } = await supabase
    .from("notifications")
    .insert({
      recipient_id: user.id,
      type: "challenge_cancelled",
      payload: { challengeId: "test" },
    })

  assertEquals(cancelledInsertError, null, "Should allow challenge_cancelled notification type")

  await recipientClient.removeAllChannels()
  await outsiderClient.removeAllChannels()

  await supabase.from("notifications").delete().eq("recipient_id", user.id)
  await deleteTestUser(user.id)
  await deleteTestUser(outsider.id)
})
