/**
 * Game Completion Integration Tests
 * Tests the full flow of game completion including move validation and ELO updates
 */

import { assertEquals, assertExists } from "https://deno.land/std@0.192.0/testing/asserts.ts"
import { createTestUser, deleteTestUser, createTestGame, callFunction, supabase, type TestUser } from '../helpers/test-utils.ts'

Deno.test("Game completion: Updates ELO ratings and stats via trigger", async () => {
  let player1: TestUser | null = null
  let player2: TestUser | null = null

  try {
    player1 = await createTestUser('elo1')
    player2 = await createTestUser('elo2')

    // Get initial ELO ratings
    const { data: initialProfiles } = await supabase
      .from('profiles')
      .select('id, username, elo_rating')
      .in('id', [player1.id, player2.id])

    const player1Initial = initialProfiles!.find(p => p.id === player1!.id)!
    const player2Initial = initialProfiles!.find(p => p.id === player2!.id)!

    assertEquals(player1Initial.elo_rating, 1200, "Should start with default ELO")
    assertEquals(player2Initial.elo_rating, 1200, "Should start with default ELO")

    // Create and play Fool's Mate
    const { gameId, yourColor } = await createTestGame(player1.token, player2.username)
    const whiteToken = yourColor === 'white' ? player1.token : player2.token
    const blackToken = yourColor === 'black' ? player1.token : player2.token

    await callFunction('validate-move', { gameId, from: 'f2', to: 'f3' }, whiteToken)
    await callFunction('validate-move', { gameId, from: 'e7', to: 'e5' }, blackToken)
    await callFunction('validate-move', { gameId, from: 'g2', to: 'g4' }, whiteToken)
    await callFunction('validate-move', { gameId, from: 'd8', to: 'h4' }, blackToken)

    // Get updated ELO ratings
    const { data: updatedProfiles } = await supabase
      .from('profiles')
      .select('id, username, elo_rating, games_played, games_won, games_lost')
      .in('id', [player1.id, player2.id])

    const player1Updated = updatedProfiles!.find(p => p.id === player1!.id)!
    const player2Updated = updatedProfiles!.find(p => p.id === player2!.id)!

    // Both should have played 1 game
    assertEquals(player1Updated.games_played, 1, "Player 1 should have 1 game played")
    assertEquals(player2Updated.games_played, 1, "Player 2 should have 1 game played")

    // Black won, white lost
    const blackPlayer = yourColor === 'black' ? player1Updated : player2Updated
    const whitePlayer = yourColor === 'white' ? player1Updated : player2Updated

    assertEquals(blackPlayer.games_won, 1, "Black should have 1 win")
    assertEquals(blackPlayer.games_lost, 0, "Black should have 0 losses")
    assertEquals(whitePlayer.games_won, 0, "White should have 0 wins")
    assertEquals(whitePlayer.games_lost, 1, "White should have 1 loss")

    // ELO should have changed (equal ratings, winner gains ~16, loser loses ~16)
    assertEquals(blackPlayer.elo_rating > 1200, true, "Black ELO should increase")
    assertEquals(whitePlayer.elo_rating < 1200, true, "White ELO should decrease")

    // Verify ELO conservation (total should be constant in zero-sum system)
    const totalBefore = player1Initial.elo_rating + player2Initial.elo_rating
    const totalAfter = player1Updated.elo_rating + player2Updated.elo_rating
    assertEquals(totalBefore, totalAfter, "Total ELO should be conserved")

    // Cleanup
    await supabase.from('games').delete().eq('id', gameId)
  } finally {
    if (player1) await deleteTestUser(player1.id)
    if (player2) await deleteTestUser(player2.id)
  }
})
