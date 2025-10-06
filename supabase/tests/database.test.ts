/**
 * Database Schema Tests
 * Tests for database tables, constraints, indexes, and RLS policies
 */

import { assertEquals, assertExists } from "https://deno.land/std@0.192.0/testing/asserts.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabaseUrl = Deno.env.get('SUPABASE_URL') || 'http://127.0.0.1:54321'
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const supabase = createClient(supabaseUrl, supabaseServiceKey)

Deno.test("Database: Tables exist", async () => {
  // Check profiles table
  const { data: profiles, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .limit(0)

  assertEquals(profileError, null, "profiles table should exist")

  // Check games table
  const { data: games, error: gamesError } = await supabase
    .from('games')
    .select('*')
    .limit(0)

  assertEquals(gamesError, null, "games table should exist")

  // Check moves table
  const { data: moves, error: movesError } = await supabase
    .from('moves')
    .select('*')
    .limit(0)

  assertEquals(movesError, null, "moves table should exist")
})

Deno.test("Database: Profile has correct default values", async () => {
  // Create a test user
  const testEmail = `test-${Date.now()}@test.com`
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email: testEmail,
    password: 'password123',
    email_confirm: true,
    user_metadata: { username: 'testuser' }
  })

  assertEquals(authError, null, "User creation should succeed")
  assertExists(authData.user, "User should be created")

  // Wait for trigger to execute
  await new Promise(resolve => setTimeout(resolve, 1000))

  // Check profile was auto-created with defaults
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', authData.user!.id)
    .single()

  assertEquals(profileError, null, "Profile should be auto-created")
  assertEquals(profile?.elo_rating, 1200, "Default ELO should be 1200")
  assertEquals(profile?.games_played, 0, "Default games_played should be 0")
  assertEquals(profile?.games_won, 0, "Default games_won should be 0")
  assertEquals(profile?.games_drawn, 0, "Default games_drawn should be 0")
  assertEquals(profile?.games_lost, 0, "Default games_lost should be 0")

  // Cleanup
  await supabase.auth.admin.deleteUser(authData.user!.id)
})

Deno.test("Database: Game has correct default FEN", async () => {
  // Create two test users
  const { data: user1 } = await supabase.auth.admin.createUser({
    email: `white-${Date.now()}@test.com`,
    password: 'password123',
    email_confirm: true,
    user_metadata: { username: 'white' }
  })

  const { data: user2 } = await supabase.auth.admin.createUser({
    email: `black-${Date.now()}@test.com`,
    password: 'password123',
    email_confirm: true,
    user_metadata: { username: 'black' }
  })

  await new Promise(resolve => setTimeout(resolve, 1000))

  // Create a game
  const { data: game, error: gameError } = await supabase
    .from('games')
    .insert({
      white_player_id: user1!.user!.id,
      black_player_id: user2!.user!.id
    })
    .select()
    .single()

  assertEquals(gameError, null, "Game creation should succeed")
  assertEquals(game?.current_fen, 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', "Default FEN should be starting position")
  assertEquals(game?.current_turn, 'white', "Default turn should be white")
  assertEquals(game?.status, 'waiting', "Default status should be waiting")

  // Cleanup
  await supabase.from('games').delete().eq('id', game!.id)
  await supabase.auth.admin.deleteUser(user1!.user!.id)
  await supabase.auth.admin.deleteUser(user2!.user!.id)
})

Deno.test("Database: RLS policies prevent unauthorized access", async () => {
  const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
  const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  })

  try {
    // Try to access games without authentication - should see no games
    const { data: games, error } = await anonClient
      .from('games')
      .select('*')

    // Should succeed but return empty array (RLS filters results)
    assertEquals(error, null, "Query should not error")
    assertEquals(games?.length || 0, 0, "Should see no games without auth")
  } finally {
    // Clean up client resources
    await anonClient.removeAllChannels()
  }
})

Deno.test("Database: Game completion trigger updates stats and ELO", async () => {
  // Create two test users
  const { data: user1 } = await supabase.auth.admin.createUser({
    email: `winner-${Date.now()}@test.com`,
    password: 'password123',
    email_confirm: true,
    user_metadata: { username: 'winner' }
  })

  const { data: user2 } = await supabase.auth.admin.createUser({
    email: `loser-${Date.now()}@test.com`,
    password: 'password123',
    email_confirm: true,
    user_metadata: { username: 'loser' }
  })

  await new Promise(resolve => setTimeout(resolve, 1000))

  // Create a game
  const { data: game } = await supabase
    .from('games')
    .insert({
      white_player_id: user1!.user!.id,
      black_player_id: user2!.user!.id,
      status: 'in_progress'
    })
    .select()
    .single()

  // Get initial stats
  const { data: whiteInitial } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user1!.user!.id)
    .single()

  const { data: blackInitial } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user2!.user!.id)
    .single()

  const totalEloBefore = whiteInitial!.elo_rating + blackInitial!.elo_rating

  // Complete the game (white wins)
  await supabase
    .from('games')
    .update({
      status: 'completed',
      result: 'white_win',
      winner_id: user1!.user!.id,
      termination_type: 'checkmate'
    })
    .eq('id', game!.id)

  await new Promise(resolve => setTimeout(resolve, 500))

  // Get updated stats
  const { data: whiteUpdated } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user1!.user!.id)
    .single()

  const { data: blackUpdated } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user2!.user!.id)
    .single()

  const totalEloAfter = whiteUpdated!.elo_rating + blackUpdated!.elo_rating

  // Verify white player (winner)
  assertEquals(whiteUpdated!.games_played, whiteInitial!.games_played + 1, "Winner games_played should increment")
  assertEquals(whiteUpdated!.games_won, whiteInitial!.games_won + 1, "Winner games_won should increment")
  assertEquals(whiteUpdated!.games_lost, whiteInitial!.games_lost, "Winner games_lost should not change")
  assertEquals(whiteUpdated!.elo_rating > whiteInitial!.elo_rating, true, "Winner ELO should increase")

  // Verify black player (loser)
  assertEquals(blackUpdated!.games_played, blackInitial!.games_played + 1, "Loser games_played should increment")
  assertEquals(blackUpdated!.games_lost, blackInitial!.games_lost + 1, "Loser games_lost should increment")
  assertEquals(blackUpdated!.games_won, blackInitial!.games_won, "Loser games_won should not change")
  assertEquals(blackUpdated!.elo_rating < blackInitial!.elo_rating, true, "Loser ELO should decrease")

  // Verify ELO conservation (zero-sum)
  assertEquals(totalEloBefore, totalEloAfter, "Total ELO should be conserved")

  // Cleanup
  await supabase.from('games').delete().eq('id', game!.id)
  await supabase.auth.admin.deleteUser(user1!.user!.id)
  await supabase.auth.admin.deleteUser(user2!.user!.id)
})
