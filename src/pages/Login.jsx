import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export default function Login() {
  const [mode, setMode] = useState('signin') // signin, signup, magic
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const navigate = useNavigate()
  const { signIn, signUp, signInWithMagicLink, signInWithGoogle } = useAuth()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setMessage('')

    try {
      if (mode === 'signup') {
        const { error } = await signUp(email, password, username)
        if (error) throw error
        setMessage('Check your email for the confirmation link!')
      } else if (mode === 'magic') {
        const { error } = await signInWithMagicLink(email)
        if (error) throw error
        setMessage('Check your email for the magic link!')
      } else {
        const { error } = await signIn(email, password)
        if (error) throw error
        navigate('/dashboard')
      }
    } catch (error) {
      setError(error.message)
    }
  }

  const handleGoogleSignIn = async () => {
    try {
      const { error } = await signInWithGoogle()
      if (error) throw error
    } catch (error) {
      setError(error.message)
    }
  }

  return (
    <div style={{ maxWidth: '400px', margin: '100px auto', padding: '20px' }}>
      <h1>CodeKids AI Game Center</h1>
      <h2>{mode === 'signup' ? 'Sign Up' : mode === 'magic' ? 'Magic Link' : 'Sign In'}</h2>

      {error && <div style={{ color: 'red', marginBottom: '10px' }}>{error}</div>}
      {message && <div style={{ color: 'green', marginBottom: '10px' }}>{message}</div>}

      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: '15px' }}>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{ width: '100%', padding: '10px', fontSize: '16px' }}
          />
        </div>

        {mode === 'signup' && (
          <div style={{ marginBottom: '15px' }}>
            <input
              type="text"
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              style={{ width: '100%', padding: '10px', fontSize: '16px' }}
            />
          </div>
        )}

        {mode !== 'magic' && (
          <div style={{ marginBottom: '15px' }}>
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={{ width: '100%', padding: '10px', fontSize: '16px' }}
            />
          </div>
        )}

        <button
          type="submit"
          style={{
            width: '100%',
            padding: '10px',
            backgroundColor: '#0070f3',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            fontSize: '16px',
            cursor: 'pointer',
          }}
        >
          {mode === 'signup' ? 'Sign Up' : mode === 'magic' ? 'Send Magic Link' : 'Sign In'}
        </button>
      </form>

      <div style={{ marginTop: '20px' }}>
        <button
          onClick={handleGoogleSignIn}
          style={{
            width: '100%',
            padding: '10px',
            backgroundColor: '#fff',
            color: '#000',
            border: '1px solid #ccc',
            borderRadius: '5px',
            fontSize: '16px',
            cursor: 'pointer',
          }}
        >
          Sign in with Google
        </button>
      </div>

      <div style={{ marginTop: '20px', textAlign: 'center' }}>
        {mode === 'signin' && (
          <>
            <button onClick={() => setMode('signup')} style={{ marginRight: '10px' }}>
              Need an account?
            </button>
            <button onClick={() => setMode('magic')}>Use magic link</button>
          </>
        )}
        {mode === 'signup' && (
          <button onClick={() => setMode('signin')}>Already have an account?</button>
        )}
        {mode === 'magic' && (
          <button onClick={() => setMode('signin')}>Back to sign in</button>
        )}
      </div>
    </div>
  )
}
