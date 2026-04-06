import { createClient } from '@supabase/supabase-js';

const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const supabaseKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim();

export const supabase = createClient(supabaseUrl, supabaseKey);

export async function saveMessage(threadId: string, role: string, content: string) {
  const keyPrefix = (supabaseKey || '').slice(0, 7);
  const { error } = await supabase
    .from('conversation_history')
    .insert([{ thread_id: threadId, role, content }]);
  
  if (error) {
    console.error(`[SUPABASE_ERROR] saveMessage failed (Key: ${keyPrefix}...):`, error.message, error.details);
  }
}

export async function getHistory(threadId: string) {
  const { data, error } = await supabase
    .from('conversation_history')
    .select('*')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true });
  
  if (error) {
    console.error('Error fetching history:', error);
    return [];
  }
  
  return data;
}

export async function isBotActive(threadId: string) {
  const { data, error } = await supabase
    .from('threads')
    .select('is_bot_active')
    .eq('id', threadId)
    .single();
  
  if (error || !data) return true; // Default to active if not found
  return data.is_bot_active;
}

export async function setBotStatus(threadId: string, isActive: boolean) {
  const { error } = await supabase
    .from('threads')
    .upsert([{ id: threadId, is_bot_active: isActive, updated_at: new Date().toISOString() }]);
  
  if (error) console.error('Error setting bot status:', error);
}

/**
 * Checks if a webhook with the given idMessage has already been processed.
 * Uses a unique constraint in the database for atomicity.
 * @returns true if already processed, false if this is the first time.
 */
export async function isWebhookProcessed(idMessage: string): Promise<boolean> {
  if (!idMessage) return false;
  
  // Try to insert the ID. If it fails with a unique constraint violation, it's a duplicate.
  const { error } = await supabase
    .from('processed_webhooks')
    .insert([{ id_message: idMessage }]);
    
  if (error) {
    if (error.code === '23505') { // Unique violation code in Postgres
      console.log(`[DEDUPLICATION] Webhook ${idMessage} already processed.`);
      return true;
    }
    console.error(`[DEDUPLICATION_ERROR] Failed to check webhook ${idMessage}:`, error.message);
  }
  
  return false;
}
