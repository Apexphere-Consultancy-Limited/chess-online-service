import { assertEquals } from "https://deno.land/std@0.192.0/testing/asserts.ts"
import {
  supabase,
  callFunction,
  createTestUser,
  deleteTestUser,
} from "../helpers/test-utils.ts"

Deno.test("mark-notification-read: rejects unauthenticated requests", async () => {
  const { response } = await callFunction("mark-notification-read", {
    body: { notificationIds: [] },
  })

  assertEquals(response.status, 401)
})

Deno.test("mark-notification-read: marks specific notifications", async () => {
  const user = await createTestUser("mark-specific")

  try {
    const { data: notifications } = await supabase
      .from("notifications")
      .insert([
        { recipient_id: user.id, type: "challenge_received", payload: { a: 1 } },
        { recipient_id: user.id, type: "game_ready", payload: { b: 2 } },
      ])
      .select("id")

    const targetId = notifications![0].id

    const { response, data } = await callFunction("mark-notification-read", {
      token: user.token,
      body: { notificationIds: [targetId] },
    })

    assertEquals(response.status, 200)
    assertEquals(data.updatedCount, 1)

    const { data: rows } = await supabase
      .from("notifications")
      .select("id, read_at")
      .eq("recipient_id", user.id)

    const target = rows!.find((row) => row.id === targetId)
    const other = rows!.find((row) => row.id !== targetId)

    assertEquals(typeof target!.read_at, "string")
    assertEquals(other!.read_at, null)

    await supabase.from("notifications").delete().eq("recipient_id", user.id)
  } finally {
    await deleteTestUser(user.id)
  }
})

Deno.test("mark-notification-read: markAll flag updates all", async () => {
  const user = await createTestUser("mark-all")

  try {
    await supabase.from("notifications").insert([
      { recipient_id: user.id, type: "challenge_received", payload: { a: 1 } },
      { recipient_id: user.id, type: "challenge_accepted", payload: { b: 2 } },
    ])

    const { response, data } = await callFunction("mark-notification-read", {
      token: user.token,
      body: { markAll: true },
    })

    assertEquals(response.status, 200)
    assertEquals(data.updatedCount, 2)

    const { data: rows } = await supabase
      .from("notifications")
      .select("read_at")
      .eq("recipient_id", user.id)

    assertEquals(rows?.every((row) => typeof row.read_at === "string"), true)

    await supabase.from("notifications").delete().eq("recipient_id", user.id)
  } finally {
    await deleteTestUser(user.id)
  }
})
