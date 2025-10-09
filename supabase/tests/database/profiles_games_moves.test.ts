import { assertEquals, assertExists } from "https://deno.land/std@0.192.0/testing/asserts.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import {
  supabase,
  supabaseUrl,
  supabaseAnonKey,
  createTestUser,
  deleteTestUser,
} from "../helpers/test-utils.ts"

const serviceClient = supabase

Deno.test("Database: Core tables exist", async () => {
  const { error: profilesError } = await serviceClient.from("profiles").select("*").limit(0)
  assertEquals(profilesError, null, "profiles table should exist")

  const { error: gamesError } = await serviceClient.from("games").select("*").limit(0)
  assertEquals(gamesError, null, "games table should exist")

  const { error: movesError } = await serviceClient.from("moves").select("*").limit(0)
  assertEquals(movesError, null, "moves table should exist")
})

Deno.test("Database: Profile defaults", async () => {
  const user = await createTestUser("profile-defaults")

  const { data: profile, error } = await serviceClient
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single()

  assertEquals(error, null, "Profile should be auto-created")
  assertExists(profile, "Profile row should exist")
  assertEquals(profile!.elo_rating, 1200)
  assertEquals(profile!.games_played, 0)
  assertEquals(profile!.games_won, 0)
  assertEquals(profile!.games_drawn, 0)
  assertEquals(profile!.games_lost, 0)

  await deleteTestUser(user.id)
})

Deno.test("Database: Game defaults", async () => {
  const white = await createTestUser("white")
  const black = await createTestUser("black")

  const { data: game, error } = await serviceClient
    .from("games")
    .insert({
      white_player_id: white.id,
      black_player_id: black.id,
    })
    .select()
    .single()

  assertEquals(error, null, "Game creation should succeed")
  assertEquals(
    game?.current_fen,
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    "Default FEN should be starting position",
  )
  assertEquals(game?.current_turn, "white")
  assertEquals(game?.status, "waiting")

  await serviceClient.from("games").delete().eq("id", game!.id)
  await deleteTestUser(white.id)
  await deleteTestUser(black.id)
})

Deno.test("Database: RLS hides games for anonymous client", async () => {
  const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  try {
    const { data, error } = await anonClient.from("games").select("*")
    assertEquals(error, null, "Anonymous query should not error")
    assertEquals(data?.length ?? 0, 0, "Anonymous client should see zero games")
  } finally {
    await anonClient.removeAllChannels()
  }
})

Deno.test("Database: Game completion trigger updates stats & ELO", async () => {
  const winner = await createTestUser("winner")
  const loser = await createTestUser("loser")

  const { data: game } = await serviceClient
    .from("games")
    .insert({
      white_player_id: winner.id,
      black_player_id: loser.id,
      status: "in_progress",
    })
    .select()
    .single()

  const { data: winnerBefore } = await serviceClient
    .from("profiles")
    .select("*")
    .eq("id", winner.id)
    .single()
  const { data: loserBefore } = await serviceClient
    .from("profiles")
    .select("*")
    .eq("id", loser.id)
    .single()

  const totalEloBefore = (winnerBefore?.elo_rating ?? 0) + (loserBefore?.elo_rating ?? 0)

  await serviceClient
    .from("games")
    .update({
      status: "completed",
      result: "white_win",
      winner_id: winner.id,
      termination_type: "checkmate",
    })
    .eq("id", game!.id)

  await new Promise((resolve) => setTimeout(resolve, 500))

  const { data: winnerAfter } = await serviceClient
    .from("profiles")
    .select("*")
    .eq("id", winner.id)
    .single()
  const { data: loserAfter } = await serviceClient
    .from("profiles")
    .select("*")
    .eq("id", loser.id)
    .single()

  assertEquals((winnerAfter?.games_played ?? 0) - (winnerBefore?.games_played ?? 0), 1)
  assertEquals((winnerAfter?.games_won ?? 0) - (winnerBefore?.games_won ?? 0), 1)
  assertEquals((loserAfter?.games_lost ?? 0) - (loserBefore?.games_lost ?? 0), 1)

  const totalEloAfter = (winnerAfter?.elo_rating ?? 0) + (loserAfter?.elo_rating ?? 0)
  assertEquals(totalEloBefore, totalEloAfter, "ELO transfers should be zero-sum")

  await serviceClient.from("games").delete().eq("id", game!.id)
  await deleteTestUser(winner.id)
  await deleteTestUser(loser.id)
})
