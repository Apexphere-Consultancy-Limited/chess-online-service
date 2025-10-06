import { supabase } from '../lib/supabase'

export const profileService = {
  // Get user profile
  async getProfile(userId) {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()

    if (error) throw error
    return data
  },

  // Update user profile
  async updateProfile(userId, updates) {
    const { data, error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', userId)
      .select()
      .single()

    if (error) throw error
    return data
  },

  // Search profiles by username
  async searchProfiles(query) {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, username, rating, avatar_url, games_played, games_won')
      .ilike('username', `%${query}%`)
      .limit(10)

    if (error) throw error
    return data
  },

  // Get leaderboard
  async getLeaderboard(limit = 100) {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, username, rating, avatar_url, games_played, games_won, games_lost, games_drawn')
      .order('rating', { ascending: false })
      .limit(limit)

    if (error) throw error
    return data
  },

  // Upload avatar
  async uploadAvatar(userId, file) {
    const fileExt = file.name.split('.').pop()
    const fileName = `${userId}.${fileExt}`
    const filePath = `avatars/${fileName}`

    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(filePath, file, { upsert: true })

    if (uploadError) throw uploadError

    const { data: { publicUrl } } = supabase.storage
      .from('avatars')
      .getPublicUrl(filePath)

    await this.updateProfile(userId, { avatar_url: publicUrl })

    return publicUrl
  }
}
