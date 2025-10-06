/**
 * Tests for validate-move Edge Function
 */

import { assertEquals, assertExists } from "https://deno.land/std@0.192.0/testing/asserts.ts"
import {
  supabase,
  createTestUser,
  deleteTestUser,
  callFunction,
  createTestGame,
  type TestUser
} from '../helpers/test-utils.ts'

Deno.test("validate-move: Rejects unauthenticated requests", async () => {
  const { response, data } = await callFunction('validate-move', {
    gameId: 'fake-id',
    from: 'e2',
    to: 'e4'
  })

  assertEquals(response.status, 401, "Should return 401 Unauthorized")
  assertEquals(data.error, 'Unauthorized', "Should have error message")
})

Deno.test("validate-move: Makes valid opening move", async () => {
  let player1: TestUser | null = null
  let player2: TestUser | null = null

  try {
    player1 = await createTestUser('whiteplayer')
    player2 = await createTestUser('blackplayer')

    const { gameId, yourColor } = await createTestGame(player1.token, player2.username)
    const whiteToken = yourColor === 'white' ? player1.token : player2.token

    // Make opening move (e2-e4)
    const { response, data } = await callFunction('validate-move', {
      gameId,
      from: 'e2',
      to: 'e4'
    }, whiteToken)

    assertEquals(response.status, 200, "Should return 200 OK")
    assertEquals(data.success, true, "Move should succeed")
    assertEquals(data.move.san, 'e4', "Should return SAN notation")
    assertEquals(data.gameStatus, 'in_progress', "Game should be in progress")

    // Verify move in database
    const { data: moves } = await supabase
      .from('moves')
      .select('*')
      .eq('game_id', gameId)

    assertEquals(moves?.length, 1, "Should have one move recorded")
    assertEquals(moves?.[0].from_square, 'e2', "From square should be e2")
    assertEquals(moves?.[0].to_square, 'e4', "To square should be e4")

    // Cleanup
    await supabase.from('games').delete().eq('id', gameId)
  } finally {
    if (player1) await deleteTestUser(player1.id)
    if (player2) await deleteTestUser(player2.id)
  }
})

Deno.test("validate-move: Rejects illegal move", async () => {
  let player1: TestUser | null = null
  let player2: TestUser | null = null

  try {
    player1 = await createTestUser('badmover1')
    player2 = await createTestUser('badmover2')

    const { gameId, yourColor } = await createTestGame(player1.token, player2.username)
    const whiteToken = yourColor === 'white' ? player1.token : player2.token

    // Try illegal move (pawn moving backwards)
    const { response, data } = await callFunction('validate-move', {
      gameId,
      from: 'e2',
      to: 'e1'
    }, whiteToken)

    assertEquals(response.status, 400, "Should return 400 Bad Request")
    assertEquals(data.error, 'Illegal move', "Should reject illegal move")

    // Cleanup
    await supabase.from('games').delete().eq('id', gameId)
  } finally {
    if (player1) await deleteTestUser(player1.id)
    if (player2) await deleteTestUser(player2.id)
  }
})

Deno.test("validate-move: Enforces turn order", async () => {
  let player1: TestUser | null = null
  let player2: TestUser | null = null

  try {
    player1 = await createTestUser('eager1')
    player2 = await createTestUser('eager2')

    const { gameId, yourColor } = await createTestGame(player1.token, player2.username)
    const blackToken = yourColor === 'black' ? player1.token : player2.token

    // Try to move as black before white moves
    const { response, data } = await callFunction('validate-move', {
      gameId,
      from: 'e7',
      to: 'e5'
    }, blackToken)

    assertEquals(response.status, 400, "Should return 400 Bad Request")
    assertEquals(data.error, 'Not your turn', "Should enforce turn order")

    // Cleanup
    await supabase.from('games').delete().eq('id', gameId)
  } finally {
    if (player1) await deleteTestUser(player1.id)
    if (player2) await deleteTestUser(player2.id)
  }
})

Deno.test("validate-move: Allows alternating moves", async () => {
  let player1: TestUser | null = null
  let player2: TestUser | null = null

  try {
    player1 = await createTestUser('alternate1')
    player2 = await createTestUser('alternate2')

    const { gameId, yourColor } = await createTestGame(player1.token, player2.username)
    const whiteToken = yourColor === 'white' ? player1.token : player2.token
    const blackToken = yourColor === 'black' ? player1.token : player2.token

    // Move 1: e2-e4 (white)
    const move1 = await callFunction('validate-move', {
      gameId,
      from: 'e2',
      to: 'e4'
    }, whiteToken)
    assertEquals(move1.data.success, true, "First move should succeed")

    // Move 2: e7-e5 (black)
    const move2 = await callFunction('validate-move', {
      gameId,
      from: 'e7',
      to: 'e5'
    }, blackToken)
    assertEquals(move2.data.success, true, "Second move should succeed")

    // Move 3: Ng1-f3 (white)
    const move3 = await callFunction('validate-move', {
      gameId,
      from: 'g1',
      to: 'f3'
    }, whiteToken)
    assertEquals(move3.data.success, true, "Third move should succeed")

    // Verify all moves in database
    const { data: moves } = await supabase
      .from('moves')
      .select('*')
      .eq('game_id', gameId)
      .order('move_number', { ascending: true })

    assertEquals(moves?.length, 3, "Should have three moves")
    assertEquals(moves?.[0].san_notation, 'e4', "First move notation")
    assertEquals(moves?.[1].san_notation, 'e5', "Second move notation")
    assertEquals(moves?.[2].san_notation, 'Nf3', "Third move notation")

    // Cleanup
    await supabase.from('games').delete().eq('id', gameId)
  } finally {
    if (player1) await deleteTestUser(player1.id)
    if (player2) await deleteTestUser(player2.id)
  }
})

Deno.test("validate-move: Detects checkmate (Fool's Mate)", async () => {
  let player1: TestUser | null = null
  let player2: TestUser | null = null

  try {
    player1 = await createTestUser('fool1')
    player2 = await createTestUser('fool2')

    const { gameId, yourColor } = await createTestGame(player1.token, player2.username)
    const whiteToken = yourColor === 'white' ? player1.token : player2.token
    const blackToken = yourColor === 'black' ? player1.token : player2.token

    // Fool's Mate sequence (fastest checkmate)
    await callFunction('validate-move', { gameId, from: 'f2', to: 'f3' }, whiteToken)
    await callFunction('validate-move', { gameId, from: 'e7', to: 'e5' }, blackToken)
    await callFunction('validate-move', { gameId, from: 'g2', to: 'g4' }, whiteToken)

    // Checkmate move
    const { data } = await callFunction('validate-move', {
      gameId,
      from: 'd8',
      to: 'h4'
    }, blackToken)

    assertEquals(data.gameStatus, 'completed', "Game should be completed")
    assertEquals(data.result, 'black_win', "Black should win")

    // Verify in database
    const { data: game } = await supabase
      .from('games')
      .select('*')
      .eq('id', gameId)
      .single()

    assertEquals(game.status, 'completed', "Game status should be completed")
    assertEquals(game.termination_type, 'checkmate', "Should be checkmate")
    assertExists(game.winner_id, "Should have winner")

    // Cleanup
    await supabase.from('games').delete().eq('id', gameId)
  } finally {
    if (player1) await deleteTestUser(player1.id)
    if (player2) await deleteTestUser(player2.id)
  }
})

Deno.test("validate-move: Records move metadata", async () => {
  let player1: TestUser | null = null
  let player2: TestUser | null = null

  try {
    player1 = await createTestUser('metadata1')
    player2 = await createTestUser('metadata2')

    const { gameId, yourColor } = await createTestGame(player1.token, player2.username)
    const whiteToken = yourColor === 'white' ? player1.token : player2.token

    // Make a capture move
    await callFunction('validate-move', { gameId, from: 'e2', to: 'e4' }, whiteToken)

    const { data: move } = await supabase
      .from('moves')
      .select('*')
      .eq('game_id', gameId)
      .single()

    assertExists(move.piece, "Should record piece type")
    assertExists(move.san_notation, "Should record SAN notation")
    assertExists(move.fen_after, "Should record FEN after move")
    assertEquals(move.move_number, 1, "Should be move number 1")
    assertExists(move.created_at, "Should have timestamp")

    // Cleanup
    await supabase.from('games').delete().eq('id', gameId)
  } finally {
    if (player1) await deleteTestUser(player1.id)
    if (player2) await deleteTestUser(player2.id)
  }
})
