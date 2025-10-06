import { supabase } from '../lib/supabase'

export const gameService = {
  // Create a new game
  async createGame(gameType, timeControl = { type: 'unlimited' }) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('Not authenticated')

    const { data, error } = await supabase
      .from('games')
      .insert({
        white_player_id: user.id,
        game_type: gameType,
        status: 'waiting',
        time_control: timeControl,
        board_state: {
          pieces: this.getInitialBoardState(),
          castling: {
            white: { kingSide: true, queenSide: true },
            black: { kingSide: true, queenSide: true }
          },
          enPassant: null,
          halfMoveClock: 0,
          fullMoveNumber: 1
        }
      })
      .select()
      .single()

    if (error) throw error
    return data
  },

  // Join an existing game
  async joinGame(gameId) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('Not authenticated')

    const { data, error } = await supabase
      .from('games')
      .update({
        black_player_id: user.id,
        status: 'active'
      })
      .eq('id', gameId)
      .eq('status', 'waiting')
      .select()
      .single()

    if (error) throw error
    return data
  },

  // Get game by ID
  async getGame(gameId) {
    const { data, error } = await supabase
      .from('games')
      .select(`
        *,
        white_player:profiles!games_white_player_id_fkey(id, username, rating, avatar_url),
        black_player:profiles!games_black_player_id_fkey(id, username, rating, avatar_url)
      `)
      .eq('id', gameId)
      .single()

    if (error) throw error
    return data
  },

  // Get all games for a user
  async getUserGames(userId) {
    const { data, error } = await supabase
      .from('games')
      .select(`
        *,
        white_player:profiles!games_white_player_id_fkey(id, username, rating, avatar_url),
        black_player:profiles!games_black_player_id_fkey(id, username, rating, avatar_url)
      `)
      .or(`white_player_id.eq.${userId},black_player_id.eq.${userId}`)
      .order('created_at', { ascending: false })

    if (error) throw error
    return data
  },

  // Get waiting games (lobby)
  async getWaitingGames() {
    const { data, error } = await supabase
      .from('games')
      .select(`
        *,
        white_player:profiles!games_white_player_id_fkey(id, username, rating, avatar_url)
      `)
      .eq('status', 'waiting')
      .order('created_at', { ascending: false })

    if (error) throw error
    return data
  },

  // Make a move
  async makeMove(gameId, move) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('Not authenticated')

    // Get current game state
    const game = await this.getGame(gameId)

    // Validate it's the player's turn
    const isWhitePlayer = game.white_player_id === user.id
    const isBlackPlayer = game.black_player_id === user.id
    const isPlayerTurn = (game.current_turn === 'white' && isWhitePlayer) ||
                         (game.current_turn === 'black' && isBlackPlayer)

    if (!isPlayerTurn) {
      throw new Error('Not your turn')
    }

    // Insert the move
    const { data: moveData, error: moveError } = await supabase
      .from('moves')
      .insert({
        game_id: gameId,
        player_id: user.id,
        move_number: move.moveNumber,
        move_notation: move.notation,
        from_square: move.from,
        to_square: move.to,
        piece: move.piece,
        captured_piece: move.captured,
        is_check: move.isCheck || false,
        is_checkmate: move.isCheckmate || false,
        is_castling: move.isCastling || false,
        is_en_passant: move.isEnPassant || false,
        promotion_piece: move.promotion
      })
      .select()
      .single()

    if (moveError) throw moveError

    // Update game state
    const nextTurn = game.current_turn === 'white' ? 'black' : 'white'
    const updateData = {
      board_state: move.newBoardState,
      current_turn: nextTurn,
      updated_at: new Date().toISOString()
    }

    // If game is over
    if (move.isCheckmate) {
      updateData.status = 'completed'
      updateData.result = game.current_turn === 'white' ? 'white_win' : 'black_win'
      updateData.winner_id = user.id
      updateData.completed_at = new Date().toISOString()
    }

    const { data: gameData, error: gameError } = await supabase
      .from('games')
      .update(updateData)
      .eq('id', gameId)
      .select()
      .single()

    if (gameError) throw gameError

    return { move: moveData, game: gameData }
  },

  // Subscribe to game updates (real-time)
  subscribeToGame(gameId, callback) {
    const channel = supabase
      .channel(`game:${gameId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'games',
          filter: `id=eq.${gameId}`
        },
        (payload) => {
          callback({ type: 'game_update', payload: payload.new })
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'moves',
          filter: `game_id=eq.${gameId}`
        },
        (payload) => {
          callback({ type: 'new_move', payload: payload.new })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  },

  // Get moves for a game
  async getMoves(gameId) {
    const { data, error } = await supabase
      .from('moves')
      .select('*')
      .eq('game_id', gameId)
      .order('move_number', { ascending: true })

    if (error) throw error
    return data
  },

  // Resign from game
  async resignGame(gameId) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('Not authenticated')

    const game = await this.getGame(gameId)
    const isWhitePlayer = game.white_player_id === user.id

    const { data, error } = await supabase
      .from('games')
      .update({
        status: 'completed',
        result: isWhitePlayer ? 'black_win' : 'white_win',
        winner_id: isWhitePlayer ? game.black_player_id : game.white_player_id,
        completed_at: new Date().toISOString()
      })
      .eq('id', gameId)
      .select()
      .single()

    if (error) throw error
    return data
  },

  // Offer draw
  async offerDraw(gameId) {
    // Implementation for draw offers (could use a separate table or game state)
    // For now, this is a placeholder
    console.log('Draw offered for game:', gameId)
  },

  // Accept draw
  async acceptDraw(gameId) {
    const { data, error } = await supabase
      .from('games')
      .update({
        status: 'completed',
        result: 'draw',
        completed_at: new Date().toISOString()
      })
      .eq('id', gameId)
      .select()
      .single()

    if (error) throw error
    return data
  },

  // Helper: Get initial chess board state
  getInitialBoardState() {
    return {
      // Standard chess starting position
      a8: 'bR', b8: 'bN', c8: 'bB', d8: 'bQ', e8: 'bK', f8: 'bB', g8: 'bN', h8: 'bR',
      a7: 'bP', b7: 'bP', c7: 'bP', d7: 'bP', e7: 'bP', f7: 'bP', g7: 'bP', h7: 'bP',
      a2: 'wP', b2: 'wP', c2: 'wP', d2: 'wP', e2: 'wP', f2: 'wP', g2: 'wP', h2: 'wP',
      a1: 'wR', b1: 'wN', c1: 'wB', d1: 'wQ', e1: 'wK', f1: 'wB', g1: 'wN', h1: 'wR'
    }
  }
}
