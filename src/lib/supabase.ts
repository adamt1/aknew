import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export async function saveMessage(threadId: string, role: string, content: string) {
  const { error } = await supabase
    .from('conversation_history')
    .insert([{ thread_id: threadId, role, content }]);
  
  if (error) console.error('Error saving message:', error);
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
