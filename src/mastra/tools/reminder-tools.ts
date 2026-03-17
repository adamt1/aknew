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
