/**
 * Shared test utilities and helpers
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

export const supabaseUrl = Deno.env.get('SUPABASE_URL') || 'http://127.0.0.1:54321'
export const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
export const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

export const supabase = createClient(supabaseUrl, supabaseServiceKey)

export interface TestUser {
  id: string
  email: string
  token: string
  username: string
}

/**
 * Create a test user with authentication
 * Uses UUID-based usernames to avoid conflicts
 */
export async function createTestUser(baseName: string): Promise<TestUser> {
  const uniqueId = crypto.randomUUID().slice(0, 8)
  const username = `${baseName}-${uniqueId}`
  const email = `${username}@test.com`

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: 'password123',
    email_confirm: true,
    user_metadata: { username }
  })

  if (error) throw error

  // Wait for profile trigger
  await new Promise(resolve => setTimeout(resolve, 1000))

  // Get session token
  const client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  })

  const { data: signInData } = await client.auth.signInWithPassword({
    email,
    password: 'password123'
  })

  // Clean up client
  await client.removeAllChannels()

  return {
    id: data.user.id,
    email,
    token: signInData!.session!.access_token,
    username
  }
}

/**
 * Delete a test user
 */
export async function deleteTestUser(userId: string): Promise<void> {
  await supabase.auth.admin.deleteUser(userId)
}

/**
 * Call an Edge Function
 */
export async function callFunction(
  functionName: string,
  body: any,
  token?: string
): Promise<{ response: Response; data: any }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  })

  const data = await response.json()
  return { response, data }
}

/**
 * Create a test game between two users
 */
export async function createTestGame(
  creatorToken: string,
  opponentUsername: string
): Promise<{ gameId: string; yourColor: string }> {
  const { data } = await callFunction('create-game', {
    opponentUsername
  }, creatorToken)

  return {
    gameId: data.game.id,
    yourColor: data.game.yourColor
  }
}

/**
 * Clean up test data
 */
export async function cleanupTestGame(gameId: string): Promise<void> {
  await supabase.from('games').delete().eq('id', gameId)
}
