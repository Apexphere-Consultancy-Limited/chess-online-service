import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { gameService } from '../services/gameService'
import { profileService } from '../services/profileService'

export default function Dashboard() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [profile, setProfile] = useState(null)
  const [myGames, setMyGames] = useState([])
  const [waitingGames, setWaitingGames] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadData()
  }, [user])

  const loadData = async () => {
    try {
      const [profileData, gamesData, waitingData] = await Promise.all([
        profileService.getProfile(user.id),
        gameService.getUserGames(user.id),
        gameService.getWaitingGames()
      ])
      setProfile(profileData)
      setMyGames(gamesData)
      setWaitingGames(waitingData.filter(g => g.white_player_id !== user.id))
    } catch (error) {
      console.error('Error loading data:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleCreateGame = async (gameType) => {
    try {
      const game = await gameService.createGame(gameType)
      navigate(`/game/${game.id}`)
    } catch (error) {
      console.error('Error creating game:', error)
    }
  }

  const handleJoinGame = async (gameId) => {
    try {
      await gameService.joinGame(gameId)
      navigate(`/game/${gameId}`)
    } catch (error) {
      console.error('Error joining game:', error)
    }
  }

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  if (loading) {
    return <div style={{ padding: '20px' }}>Loading...</div>
  }

  return (
    <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '30px' }}>
        <div>
          <h1>CodeKids AI Game Center</h1>
          {profile && (
            <div style={{ marginTop: '10px' }}>
              <h2>Welcome, {profile.username}!</h2>
              <p>Rating: {profile.rating} | Games: {profile.games_played} | Won: {profile.games_won} | Lost: {profile.games_lost} | Drawn: {profile.games_drawn}</p>
            </div>
          )}
        </div>
        <button
          onClick={handleSignOut}
          style={{
            padding: '10px 20px',
            backgroundColor: '#dc3545',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor: 'pointer',
            height: 'fit-content'
          }}
        >
          Sign Out
        </button>
      </div>

      <div style={{ marginBottom: '30px' }}>
        <h2>Create New Game</h2>
        <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
          <button
            onClick={() => handleCreateGame('realtime')}
            style={{
              padding: '10px 20px',
              backgroundColor: '#28a745',
              color: 'white',
              border: 'none',
              borderRadius: '5px',
              cursor: 'pointer'
            }}
          >
            Create Real-time Game
          </button>
          <button
            onClick={() => handleCreateGame('turn_based')}
            style={{
              padding: '10px 20px',
              backgroundColor: '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '5px',
              cursor: 'pointer'
            }}
          >
            Create Turn-based Game
          </button>
        </div>
      </div>

      <div style={{ marginBottom: '30px' }}>
        <h2>Available Games</h2>
        {waitingGames.length === 0 ? (
          <p>No games waiting for players</p>
        ) : (
          <div style={{ display: 'grid', gap: '10px' }}>
            {waitingGames.map(game => (
              <div
                key={game.id}
                style={{
                  padding: '15px',
                  border: '1px solid #ccc',
                  borderRadius: '5px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}
              >
                <div>
                  <strong>{game.white_player.username}</strong> is looking for a {game.game_type} game
                  <div style={{ fontSize: '12px', color: '#666', marginTop: '5px' }}>
                    Rating: {game.white_player.rating}
                  </div>
                </div>
                <button
                  onClick={() => handleJoinGame(game.id)}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: '#28a745',
                    color: 'white',
                    border: 'none',
                    borderRadius: '5px',
                    cursor: 'pointer'
                  }}
                >
                  Join Game
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h2>My Games</h2>
        {myGames.length === 0 ? (
          <p>No games yet</p>
        ) : (
          <div style={{ display: 'grid', gap: '10px' }}>
            {myGames.map(game => (
              <div
                key={game.id}
                style={{
                  padding: '15px',
                  border: '1px solid #ccc',
                  borderRadius: '5px',
                  cursor: 'pointer'
                }}
                onClick={() => navigate(`/game/${game.id}`)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <div>
                    <strong>
                      {game.white_player.username} vs {game.black_player?.username || 'Waiting...'}
                    </strong>
                    <div style={{ fontSize: '12px', color: '#666', marginTop: '5px' }}>
                      Status: {game.status} | Type: {game.game_type}
                      {game.result && ` | Result: ${game.result.replace('_', ' ')}`}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    {game.status === 'active' && (
                      <span style={{ color: '#28a745', fontWeight: 'bold' }}>
                        {game.current_turn === 'white'
                          ? (game.white_player_id === user.id ? 'Your turn' : 'Opponent\'s turn')
                          : (game.black_player_id === user.id ? 'Your turn' : 'Opponent\'s turn')}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
