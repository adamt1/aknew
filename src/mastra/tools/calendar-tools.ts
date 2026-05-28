import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { googleCalendar } from "../../lib/google-calendar";

// Strip Z/UTC offset so Google Calendar honors timeZone: 'Asia/Jerusalem'.
// The LLM often sends UTC times (e.g. "17:30Z") when the user means Israel local time.
function stripUtcSuffix(iso: string): string {
  return iso.replace(/Z$/, '').replace(/([+-]\d{2}:?\d{2})$/, '');
}

export const scheduleCalendarEvent = createTool({
  id: "scheduleCalendarEvent",
  description: "Records an entry in Google Calendar. Use this for ANY recording request: meetings, appointments, supply logs, cleaning records, documentation, or anything the user asks to add to calendar or record. You MUST calculate the start and end ISO-8601 timestamps. When recording a log/supply entry, set start_time to the current time and end_time 30 minutes later.",
  inputSchema: z.object({
    summary: z.string().describe("Title of the meeting."),
    description: z.string().optional().describe("Optional description or notes for the meeting."),
    start_time: z.string().describe("ISO-8601 start timestamp."),
    end_time: z.string().describe("ISO-8601 end timestamp. Usually 30-60 minutes after start_time if not specified."),
    calendar_id: z.string().default(process.env.GOOGLE_CALENDAR_ID || 'primary').describe("The Google Calendar ID. Default is from GOOGLE_CALENDAR_ID env var, then 'primary'.")

  }),
  execute: async (inputData) => {
    try {
      // Strip Z/UTC offset so Google Calendar uses timeZone: 'Asia/Jerusalem' as local time.
      const startLocal = stripUtcSuffix(inputData.start_time);
      const endLocal = stripUtcSuffix(inputData.end_time);

      const event = {
        summary: inputData.summary,
        description: inputData.description,
        start: {
          dateTime: startLocal,
          timeZone: 'Asia/Jerusalem',
        },
        end: {
          dateTime: endLocal,
          timeZone: 'Asia/Jerusalem',
        },
        reminders: {
          useDefault: false,
          overrides: [],
        },
      };

      console.log(`[CALENDAR_TOOL] Scheduling event on calendar: "${inputData.calendar_id}"`);
      console.log(`[CALENDAR_TOOL] Time (local): ${startLocal} to ${endLocal}`);

      // Improved tool-level deduplication: Look for identical events in the last 24 hours
      const startOfDay = new Date(startLocal);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(startLocal);
      endOfDay.setHours(23, 59, 59, 999);

      const existingEvents = await googleCalendar.listEvents(inputData.calendar_id, {
        timeMin: startOfDay.toISOString(),
        timeMax: endOfDay.toISOString(),
        q: inputData.summary
      });
      
      const isDuplicate = existingEvents.find((e: any) => 
        e.summary === inputData.summary
      );
      
      if (isDuplicate) {
         console.log(`[CALENDAR_TOOL] Detected duplicate event "${inputData.summary}" already exists. Skipping insertion.`);
         const startStr = startLocal.replace(/[-:]/g, '').split('.')[0];
         const endStr = endLocal.replace(/[-:]/g, '').split('.')[0];
         const addToCalendarUrl = `https://www.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(inputData.summary)}&dates=${startStr}/${endStr}&details=${encodeURIComponent(inputData.description || '')}&sf=true&output=xml`;

         return {
           success: true,
           message: `Event "${inputData.summary}" was already scheduled. Returning details.`,
           event_link: isDuplicate.htmlLink,
           add_to_your_calendar_link: addToCalendarUrl,
           start: startLocal
         };
      }

      const result = await googleCalendar.createEvent(inputData.calendar_id, event);

      // Generate a "Add to Calendar" link for the user (local time, no Z suffix)
      const startStr = startLocal.replace(/[-:]/g, '').split('.')[0];
      const endStr = endLocal.replace(/[-:]/g, '').split('.')[0];
      const addToCalendarUrl = `https://www.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(inputData.summary)}&dates=${startStr}/${endStr}&details=${encodeURIComponent(inputData.description || '')}&sf=true&output=xml`;

      return {
        success: true,
        message: `Event "${inputData.summary}" scheduled successfully on Rotem's internal calendar. \n\nCRITICAL: Please provide this link to the user to add it to their own calendar: ${addToCalendarUrl}`,
        event_link: result.htmlLink,
        add_to_your_calendar_link: addToCalendarUrl,
        start: startLocal
      };
    } catch (error: any) {
      console.error('[CALENDAR_TOOL_ERROR]', error);
      // Hard fail: Do not return any links if the sync failed.
      return {
        success: false,
        error: error.message || 'Unknown error occurred while scheduling calendar event.',
        CRITICAL_INSTRUCTION_FOR_AI: "Tell the user that scheduled was NOT successful due to a technical error with Google Calendar (likely permissions). Don't give any links."
      };
    }
  }
});

export const listCalendarEvents = createTool({
  id: "listCalendarEvents",
  description: "Lists or searches for events on the Google Calendar. Use this when the user asks 'when did X happen?' or 'find my record of Y'.",
  inputSchema: z.object({
    q: z.string().optional().describe("Search query to filter events (e.g., 'cleaning supplies')."),
    timeMin: z.string().describe("ISO-8601 start timestamp to search from (e.g. '2026-03-01T00:00:00Z')."),
    timeMax: z.string().optional().describe("ISO-8601 end timestamp to search up to."),
    calendar_id: z.string().default(process.env.GOOGLE_CALENDAR_ID || 'primary').describe("The Google Calendar ID.")
  }),
  execute: async (inputData) => {
    try {
      const events = await googleCalendar.listEvents(inputData.calendar_id, {
        timeMin: inputData.timeMin,
        timeMax: inputData.timeMax,
        q: inputData.q
      });

      return {
        success: true,
        count: events.length,
        events: events.map((e: any) => ({
          id: e.id,
          summary: e.summary,
          start: e.start?.dateTime || e.start?.date,
          description: e.description
        }))
      };
    } catch (error: any) {
      console.error('[LIST_CALENDAR_TOOL_ERROR]', error);
      return { success: false, error: error.message };
    }
  }
});

export const deleteCalendarEvent = createTool({
  id: "deleteCalendarEvent",
  description: "Deletes an event from the Google Calendar. IMPORTANT: You must first find the event ID using 'listCalendarEvents'.",
  inputSchema: z.object({
    eventId: z.string().describe("The ID of the event to delete."),
    calendar_id: z.string().default(process.env.GOOGLE_CALENDAR_ID || 'primary').describe("The Google Calendar ID.")
  }),
  execute: async (inputData) => {
    try {
      console.log(`[CALENDAR_TOOL] Deleting event ${inputData.eventId} from calendar: "${inputData.calendar_id}"`);
      await googleCalendar.deleteEvent(inputData.calendar_id, inputData.eventId);
      return {
        success: true,
        message: `Event deleted successfully.`
      };
    } catch (error: any) {
      console.error('[DELETE_CALENDAR_TOOL_ERROR]', error);
      return { success: false, error: error.message };
    }
  }
});
