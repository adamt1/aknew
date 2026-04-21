import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { supabase } from "../../lib/supabase";

export const scheduleReminder = createTool({
  id: "scheduleReminder",
  description: "Schedules a reminder for a specific date and time. Use this when the user asks to be reminded about something. You MUST calculate the absolute date and time string based on the current time provided in your prompt.",
  inputSchema: z.object({
    chat_id: z.string().describe("The WhatsApp chat ID to send the reminder to."),
    reminder_text: z.string().describe("The clear text of the reminder (what to remind the user about)."),
    remind_at: z.string().describe("The ISO-8601 timestamp for when the reminder should be sent. Must be in the future.")
  }),
  execute: async (inputData) => {
    try {
      // 1. Tool-level deduplication: Check for identical pending reminders in a 6hr window
      const sixHoursAgo = new Date(new Date(inputData.remind_at).getTime() - 6 * 60 * 60 * 1000).toISOString();
      const sixHoursAhead = new Date(new Date(inputData.remind_at).getTime() + 6 * 60 * 60 * 1000).toISOString();
      
      const { data: existing } = await supabase
        .from('reminders')
        .select('*')
        .eq('chat_id', inputData.chat_id)
        .eq('reminder_text', inputData.reminder_text)
        .eq('status', 'pending')
        .gte('remind_at', sixHoursAgo)
        .lte('remind_at', sixHoursAhead);

      if (existing && existing.length > 0) {
        console.log(`[REMINDER_TOOL] Duplicate reminder detected. Skipping.`);
        return {
          success: true,
          message: 'Reminder already scheduled. Skipping duplicate.',
          scheduled_for: existing[0].remind_at
        };
      }

      const { error } = await supabase
        .from('reminders')
        .insert([{
          chat_id: inputData.chat_id,
          reminder_text: inputData.reminder_text,
          remind_at: inputData.remind_at,
          status: 'pending'
        }]);

      if (error) {
        throw new Error(`Database error: ${error.message}`);
      }

      return {
        success: true,
        message: 'Reminder scheduled successfully.',
        scheduled_for: inputData.remind_at
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Unknown error occurred while scheduling reminder.'
      };
    }
  }
});
