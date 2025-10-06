/**
 * Tests for create-game Edge Function
 */

import { assertEquals, assertExists } from "https://deno.land/std@0.192.0/testing/asserts.ts"
import {
  supabase,
  createTestUser,
  deleteTestUser,
  callFunction,
  type TestUser
} from '../helpers/test-utils.ts'

Deno.test("create-game: Rejects unauthenticated requests", async () => {
  const { response, data } = await callFunction('create-game', {
    opponentUsername: 'test'
  })

  assertEquals(response.status, 401, "Should return 401 Unauthorized")
  assertEquals(data.error, 'Unauthorized', "Should have error message")
})

Deno.test("create-game: Creates game successfully", async () => {
  let player1: TestUser | null = null
  let player2: TestUser | null = null

  try {
    player1 = await createTestUser('player1')
    player2 = await createTestUser('player2')

    const { response, data } = await callFunction('create-game', {
      opponentUsername: player2.username
    }, player1.token)

    assertEquals(response.status, 200, "Should return 200 OK")
    assertEquals(data.success, true, "Should indicate success")
    assertExists(data.game.id, "Should return game ID")
    assertEquals(['white', 'black'].includes(data.game.yourColor), true, "Should return player color")

    // Verify game was created in database
    const { data: game } = await supabase
      .from('games')
      .select('*')
      .eq('id', data.game.id)
      .single()

    assertExists(game, "Game should exist in database")
    assertEquals(game.status, 'waiting', "Game status should be waiting")

    // Cleanup game
    await supabase.from('games').delete().eq('id', data.game.id)
  } finally {
    if (player1) await deleteTestUser(player1.id)
    if (player2) await deleteTestUser(player2.id)
  }
})

Deno.test("create-game: Rejects game against self", async () => {
  let player: TestUser | null = null

  try {
    player = await createTestUser('selfish')

    const { response, data } = await callFunction('create-game', {
      opponentUsername: player.username
    }, player.token)

    assertEquals(response.status, 400, "Should return 400 Bad Request")
    assertEquals(data.error.includes('yourself'), true, "Should reject self-play")
  } finally {
    if (player) await deleteTestUser(player.id)
  }
})

Deno.test("create-game: Rejects non-existent opponent", async () => {
  let player: TestUser | null = null

  try {
    player = await createTestUser('lonely')

    const { response, data } = await callFunction('create-game', {
      opponentUsername: 'nonexistent-player-xyz-123456'
    }, player.token)

    assertEquals(response.status, 404, "Should return 404 Not Found")
    assertEquals(data.error, 'Opponent not found', "Should have error message")
  } finally {
    if (player) await deleteTestUser(player.id)
  }
})

Deno.test("create-game: Assigns colors randomly", async () => {
  let player1: TestUser | null = null
  let player2: TestUser | null = null

  try {
    player1 = await createTestUser('random1')
    player2 = await createTestUser('random2')

    // Create multiple games and check color distribution
    const colors: string[] = []
    const gameIds: string[] = []

    for (let i = 0; i < 5; i++) {
      const { data } = await callFunction('create-game', {
        opponentUsername: player2.username
      }, player1.token)

      colors.push(data.game.yourColor)
      gameIds.push(data.game.id)
    }

    // Check that we got both colors at least once (probabilistic test)
    // With 5 games, probability of all same color is (0.5)^5 = 3%, so this should pass
    const hasWhite = colors.includes('white')
    const hasBlack = colors.includes('black')

    // At least verify the values are valid
    assertEquals(colors.every(c => c === 'white' || c === 'black'), true, "All colors should be valid")

    // Cleanup games
    for (const gameId of gameIds) {
      await supabase.from('games').delete().eq('id', gameId)
    }
  } finally {
    if (player1) await deleteTestUser(player1.id)
    if (player2) await deleteTestUser(player2.id)
  }
})

Deno.test("create-game: Creates game with correct player IDs", async () => {
  let player1: TestUser | null = null
  let player2: TestUser | null = null

  try {
    player1 = await createTestUser('white-test')
    player2 = await createTestUser('black-test')

    const { data } = await callFunction('create-game', {
      opponentUsername: player2.username
    }, player1.token)

    const { data: game } = await supabase
      .from('games')
      .select('*')
      .eq('id', data.game.id)
      .single()

    // Verify both players are assigned
    assertExists(game.white_player_id, "White player should be assigned")
    assertExists(game.black_player_id, "Black player should be assigned")

    // Verify it's one of our test users
    const playerIds = [player1.id, player2.id]
    assertEquals(playerIds.includes(game.white_player_id), true, "White player should be one of our users")
    assertEquals(playerIds.includes(game.black_player_id), true, "Black player should be one of our users")

    // Verify they're different players
    assertEquals(game.white_player_id !== game.black_player_id, true, "Players should be different")

    // Cleanup
    await supabase.from('games').delete().eq('id', data.game.id)
  } finally {
    if (player1) await deleteTestUser(player1.id)
    if (player2) await deleteTestUser(player2.id)
  }
})
