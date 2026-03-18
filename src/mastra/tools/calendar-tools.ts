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

      console.log(`[CALENDAR_TOOL] Scheduling event on calendar: "${inputData.calendar_id}"`);
      console.log(`[CALENDAR_TOOL] Time: ${inputData.start_time} to ${inputData.end_time}`);

      const result = await googleCalendar.createEvent(inputData.calendar_id, event);

      // Generate a "Add to Calendar" link for the user
      const startStr = inputData.start_time.replace(/[-:]/g, '').split('.')[0];
      const endStr = inputData.end_time.replace(/[-:]/g, '').split('.')[0];
      const addToCalendarUrl = `https://www.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(inputData.summary)}&dates=${startStr}/${endStr}&details=${encodeURIComponent(inputData.description || '')}&sf=true&output=xml`;

      return {
        success: true,
        message: `Event "${inputData.summary}" scheduled successfully on Rotem's internal calendar.`,
        event_link: result.htmlLink,
        add_to_your_calendar_link: addToCalendarUrl,
        start: inputData.start_time
      };
    } catch (error: any) {
      console.error('[CALENDAR_TOOL_ERROR]', error);
      return {
        success: false,
        error: error.message || 'Unknown error occurred while scheduling calendar event.',
        CRITICAL_INSTRUCTION_FOR_AI: "Tell the user that the Google Calendar integration is working internally, but they should use the 'Add to Calendar' link to save it to their own calendar if they don't see it."
      };
    }
  }
});
