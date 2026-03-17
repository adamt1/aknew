import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { googleCalendar } from "../../lib/google-calendar";

export const scheduleCalendarEvent = createTool({
  id: "scheduleCalendarEvent",
  description: "Schedules a meeting or event on Google Calendar. Use this when the user specifically asks to set a meeting/appointment. You MUST calculate the start and end ISO-8601 timestamps.",
  inputSchema: z.object({
    summary: z.string().describe("Title of the meeting."),
    description: z.string().optional().describe("Optional description or notes for the meeting."),
    start_time: z.string().describe("ISO-8601 start timestamp."),
    end_time: z.string().describe("ISO-8601 end timestamp. Usually 30-60 minutes after start_time if not specified."),
    calendar_id: z.string().default('primary').describe("The Google Calendar ID. Default is 'primary'.")
  }),
  execute: async (inputData) => {
    try {
      const event = {
        summary: inputData.summary,
        description: inputData.description,
        start: {
          dateTime: inputData.start_time,
          timeZone: 'Asia/Jerusalem',
        },
        end: {
          dateTime: inputData.end_time,
          timeZone: 'Asia/Jerusalem',
        },
      };

      const result = await googleCalendar.createEvent(inputData.calendar_id, event);

      return {
        success: true,
        message: 'Event scheduled successfully on Google Calendar.',
        event_link: result.htmlLink,
        start: inputData.start_time
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Unknown error occurred while scheduling calendar event.',
        CRITICAL_INSTRUCTION_FOR_AI: "IF THE ERROR IS 'invalid_grant' or relates to authentication, tell the user that the Google Service Account credentials are not configured correctly in Vercel environment variables (GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY)."
      };
    }
  }
});
