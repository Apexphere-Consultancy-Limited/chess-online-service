import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { gameService } from '../services/gameService'

export default function ChessGame() {
  const { gameId } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [game, setGame] = useState(null)
  const [moves, setMoves] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedSquare, setSelectedSquare] = useState(null)

  useEffect(() => {
    loadGame()
  }, [gameId])

  useEffect(() => {
    if (!gameId) return

    // Subscribe to real-time updates
    const unsubscribe = gameService.subscribeToGame(gameId, (update) => {
      if (update.type === 'game_update') {
        setGame(prev => ({ ...prev, ...update.payload }))
      } else if (update.type === 'new_move') {
        setMoves(prev => [...prev, update.payload])
      }
    })

    return () => unsubscribe()
  }, [gameId])

  const loadGame = async () => {
    try {
      const [gameData, movesData] = await Promise.all([
        gameService.getGame(gameId),
        gameService.getMoves(gameId)
      ])
      setGame(gameData)
      setMoves(movesData)
    } catch (error) {
      console.error('Error loading game:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSquareClick = (square) => {
    if (game.status !== 'active') return

    const isWhitePlayer = game.white_player_id === user.id
    const isBlackPlayer = game.black_player_id === user.id
    const isMyTurn = (game.current_turn === 'white' && isWhitePlayer) ||
                     (game.current_turn === 'black' && isBlackPlayer)

    if (!isMyTurn) {
      alert("It's not your turn!")
      return
    }

    if (!selectedSquare) {
      // Select a piece
      const piece = game.board_state.pieces[square]
      if (piece) {
        const pieceColor = piece[0]
        const playerColor = isWhitePlayer ? 'w' : 'b'
        if (pieceColor === playerColor) {
          setSelectedSquare(square)
        }
      }
    } else {
      // Move the piece
      handleMove(selectedSquare, square)
      setSelectedSquare(null)
    }
  }

  const handleMove = async (from, to) => {
    // This is a simplified version. In production, you'd use a chess library
    // like chess.js to validate moves and generate the new board state
    try {
      const piece = game.board_state.pieces[from]
      const captured = game.board_state.pieces[to]

      const newPieces = { ...game.board_state.pieces }
      delete newPieces[from]
      newPieces[to] = piece

      const move = {
        from,
        to,
        piece,
        captured,
        notation: `${piece}${from}-${to}`, // Simplified notation
        moveNumber: moves.length + 1,
        newBoardState: {
          ...game.board_state,
          pieces: newPieces
        }
      }

      await gameService.makeMove(gameId, move)
    } catch (error) {
      console.error('Error making move:', error)
      alert(error.message)
    }
  }

  const handleResign = async () => {
    if (window.confirm('Are you sure you want to resign?')) {
      try {
        await gameService.resignGame(gameId)
        navigate('/dashboard')
      } catch (error) {
        console.error('Error resigning:', error)
      }
    }
  }

  if (loading) {
    return <div style={{ padding: '20px' }}>Loading game...</div>
  }

  if (!game) {
    return <div style={{ padding: '20px' }}>Game not found</div>
  }

  const isWhitePlayer = game.white_player_id === user.id
  const isBlackPlayer = game.black_player_id === user.id
  const playerColor = isWhitePlayer ? 'white' : 'black'

  return (
    <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ marginBottom: '20px' }}>
        <button
          onClick={() => navigate('/dashboard')}
          style={{
            padding: '10px 20px',
            backgroundColor: '#6c757d',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor: 'pointer'
          }}
        >
          Back to Dashboard
        </button>
      </div>

      <div style={{ display: 'flex', gap: '30px' }}>
        {/* Chess Board */}
        <div>
          <div style={{ marginBottom: '10px' }}>
            <strong>{game.black_player?.username || 'Waiting...'}</strong> (Black)
            {game.black_player && <span> - Rating: {game.black_player.rating}</span>}
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(8, 60px)',
              gridTemplateRows: 'repeat(8, 60px)',
              border: '2px solid #333',
              width: 'fit-content'
            }}
          >
            {Array.from({ length: 64 }, (_, i) => {
              const row = Math.floor(i / 8)
              const col = i % 8
              const square = `${String.fromCharCode(97 + col)}${8 - row}`
              const isLight = (row + col) % 2 === 0
              const piece = game.board_state.pieces[square]
              const isSelected = selectedSquare === square

              return (
                <div
                  key={square}
                  onClick={() => handleSquareClick(square)}
                  style={{
                    backgroundColor: isSelected ? '#ffd700' : (isLight ? '#f0d9b5' : '#b58863'),
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    fontSize: '40px',
                    userSelect: 'none'
                  }}
                >
                  {piece && getPieceSymbol(piece)}
                </div>
              )
            })}
          </div>

          <div style={{ marginTop: '10px' }}>
            <strong>{game.white_player.username}</strong> (White)
            <span> - Rating: {game.white_player.rating}</span>
          </div>
        </div>

        {/* Game Info */}
        <div style={{ flex: 1 }}>
          <h2>Game Info</h2>
          <div style={{ marginBottom: '20px' }}>
            <p><strong>Status:</strong> {game.status}</p>
            <p><strong>Type:</strong> {game.game_type}</p>
            <p><strong>Current Turn:</strong> {game.current_turn}</p>
            {game.status === 'active' && (
              <p>
                <strong>Your Color:</strong> {playerColor}
                {' - '}
                {((game.current_turn === 'white' && isWhitePlayer) ||
                  (game.current_turn === 'black' && isBlackPlayer)) ? (
                  <span style={{ color: '#28a745' }}>Your turn!</span>
                ) : (
                  <span>Opponent's turn</span>
                )}
              </p>
            )}
            {game.result && <p><strong>Result:</strong> {game.result.replace('_', ' ')}</p>}
          </div>

          {game.status === 'waiting' && (
            <div style={{ padding: '15px', backgroundColor: '#fff3cd', borderRadius: '5px', marginBottom: '20px' }}>
              Waiting for opponent to join...
            </div>
          )}

          {game.status === 'active' && (
            <div style={{ marginBottom: '20px' }}>
              <button
                onClick={handleResign}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#dc3545',
                  color: 'white',
                  border: 'none',
                  borderRadius: '5px',
                  cursor: 'pointer'
                }}
              >
                Resign
              </button>
            </div>
          )}

          <h3>Moves History</h3>
          <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
            {moves.length === 0 ? (
              <p>No moves yet</p>
            ) : (
              <div>
                {moves.map((move, index) => (
                  <div key={move.id} style={{ padding: '5px 0', borderBottom: '1px solid #eee' }}>
                    {index + 1}. {move.move_notation}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// Helper function to get piece symbols
function getPieceSymbol(piece) {
  const symbols = {
    wK: '♔', wQ: '♕', wR: '♖', wB: '♗', wN: '♘', wP: '♙',
    bK: '♚', bQ: '♛', bR: '♜', bB: '♝', bN: '♞', bP: '♟'
  }
  return symbols[piece] || ''
}
