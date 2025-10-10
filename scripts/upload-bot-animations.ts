/**
 * Upload bot animation GIFs to Supabase Storage
 *
 * This script uploads all bot animation GIFs from tmp/resources/ to the
 * bot-animations bucket in Supabase Storage, organizing them by difficulty.
 *
 * Usage:
 *   npm run upload:animations
 *
 * Environment variables required:
 *   SUPABASE_URL - Your Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY - Service role key (admin access)
 */

import { createClient } from '@supabase/supabase-js'
import { readdir, readFile, stat } from 'fs/promises'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Initialize Supabase client with service role key (admin access)
const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error('❌ Missing required environment variables:')
  console.error('   SUPABASE_URL')
  console.error('   SUPABASE_SERVICE_ROLE_KEY')
  console.error('')
  console.error('Please set these in your .env file or environment')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
})

const BUCKET_NAME = 'bot-animations'
const RESOURCES_DIR = join(__dirname, '..', 'tmp', 'resources')

interface UploadResult {
  success: boolean
  path: string
  size: number
  error?: string
}

async function uploadFile(
  botType: string,
  fileName: string,
  fileBuffer: Buffer
): Promise<UploadResult> {
  const storagePath = `${botType}/${fileName}`
  const fileSizeKB = (fileBuffer.length / 1024).toFixed(2)

  try {
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(storagePath, fileBuffer, {
        contentType: 'image/gif',
        cacheControl: '31536000', // 1 year cache
        upsert: true // Overwrite if exists
      })

    if (error) {
      return {
        success: false,
        path: storagePath,
        size: fileBuffer.length,
        error: error.message
      }
    }

    return {
      success: true,
      path: storagePath,
      size: fileBuffer.length
    }
  } catch (err) {
    return {
      success: false,
      path: storagePath,
      size: fileBuffer.length,
      error: err instanceof Error ? err.message : 'Unknown error'
    }
  }
}

async function verifyBucket(): Promise<boolean> {
  try {
    const { data, error } = await supabase.storage.getBucket(BUCKET_NAME)

    if (error) {
      console.error(`❌ Bucket '${BUCKET_NAME}' not found. Please create it first.`)
      console.error(`   Run: supabase db reset`)
      return false
    }

    console.log(`✓ Found bucket: ${BUCKET_NAME}`)
    console.log(`  Public: ${data.public}`)
    console.log(`  File size limit: ${data.file_size_limit ? `${(data.file_size_limit / 1024 / 1024).toFixed(2)}MB` : 'unlimited'}`)
    console.log('')
    return true
  } catch (err) {
    console.error('❌ Error verifying bucket:', err)
    return false
  }
}

async function uploadBotAnimations() {
  console.log('🤖 Bot Animation Uploader')
  console.log('========================')
  console.log('')

  // Verify bucket exists
  const bucketExists = await verifyBucket()
  if (!bucketExists) {
    process.exit(1)
  }

  // Check if resources directory exists
  try {
    await stat(RESOURCES_DIR)
  } catch (err) {
    console.error(`❌ Resources directory not found: ${RESOURCES_DIR}`)
    console.error('   Please ensure tmp/resources/ contains the bot animation GIFs')
    process.exit(1)
  }

  const botTypes = ['easy-bot', 'medium-bot', 'hard-bot']
  const results: UploadResult[] = []
  let totalSize = 0

  for (const botType of botTypes) {
    const botDir = join(RESOURCES_DIR, botType)

    try {
      // Check if bot directory exists
      await stat(botDir)
    } catch (err) {
      console.warn(`⚠️  Skipping ${botType}: directory not found`)
      continue
    }

    console.log(`📁 Processing ${botType}...`)

    try {
      const files = await readdir(botDir)
      const gifFiles = files.filter(f => f.toLowerCase().endsWith('.gif'))

      if (gifFiles.length === 0) {
        console.log(`   No GIF files found in ${botType}`)
        continue
      }

      for (const file of gifFiles) {
        const filePath = join(botDir, file)
        const fileBuffer = await readFile(filePath)
        const fileSizeKB = (fileBuffer.length / 1024).toFixed(2)

        process.stdout.write(`   Uploading ${file} (${fileSizeKB}KB)... `)

        const result = await uploadFile(botType, file, fileBuffer)
        results.push(result)
        totalSize += result.size

        if (result.success) {
          console.log('✓')
        } else {
          console.log(`✗ ${result.error}`)
        }
      }
    } catch (err) {
      console.error(`   ✗ Error processing ${botType}:`, err)
    }

    console.log('')
  }

  // Print summary
  console.log('Summary')
  console.log('=======')
  const successful = results.filter(r => r.success).length
  const failed = results.filter(r => !r.success).length
  const totalSizeMB = (totalSize / 1024 / 1024).toFixed(2)

  console.log(`✓ Successful uploads: ${successful}`)
  if (failed > 0) {
    console.log(`✗ Failed uploads: ${failed}`)
  }
  console.log(`📦 Total size: ${totalSizeMB}MB`)
  console.log('')

  if (failed > 0) {
    console.log('Failed uploads:')
    results
      .filter(r => !r.success)
      .forEach(r => console.log(`  - ${r.path}: ${r.error}`))
    console.log('')
  }

  // Print example URLs
  if (successful > 0) {
    console.log('Example URLs:')
    const exampleResult = results.find(r => r.success)
    if (exampleResult) {
      const publicUrl = `${supabaseUrl}/storage/v1/object/public/${BUCKET_NAME}/${exampleResult.path}`
      console.log(`  ${publicUrl}`)
      console.log('')
      console.log('Verify the URL is accessible in your browser!')
    }
  }

  console.log('✅ Upload complete!')

  if (failed > 0) {
    process.exit(1)
  }
}

// Run the upload
uploadBotAnimations().catch(err => {
  console.error('❌ Fatal error:', err)
  process.exit(1)
})
