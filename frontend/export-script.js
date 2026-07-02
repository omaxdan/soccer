import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

async function exportTable() {
  // CHANGE THIS to your actual table name
  const { data, error } = await supabase
    .from('tournaments')  // 👈 Change this to your table name
    .select('*')
    .limit(100)  // Start with 100 rows to test
  
  if (error) {
    console.error('Error:', error)
    return
  }
  
  if (!data || data.length === 0) {
    console.log('No data found')
    return
  }
  
  
  // Export as formatted TXT
  const txt = data.map(row => 
    Object.entries(row).map(([key, value]) => `${key}: ${value}`).join(' | ')
  ).join('\n')
  fs.writeFileSync('export.txt', txt)
  console.log('✅ Exported TXT')
  
  console.log(`📦 Total rows exported: ${data.length}`)
}

exportTable()