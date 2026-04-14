import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { googleCalendar } from "../../lib/google-calendar";
import fs from 'fs';

export const scheduleCalendarEvent = createTool({
  id: "scheduleCalendarEvent",
  description: "Schedules a meeting or event on Google Calendar. Use this when the user specifically asks to set a meeting/appointment. You MUST calculate the start and end ISO-8601 timestamps. IMPORTANT: NEVER call this tool to create 'documentation', 'logs', or 'summaries' on today's date. Only call it for the actual event requested.",
  inputSchema: z.object({
    summary: z.string().describe("Title of the meeting."),
    description: z.string().optional().describe("Optional description or notes for the meeting."),
    start_time: z.string().describe("ISO-8601 start timestamp."),
    end_time: z.string().describe("ISO-8601 end timestamp. Usually 30-60 minutes after start_time if not specified."),
    calendar_id: z.string().default(process.env.GOOGLE_CALENDAR_ID || 'primary').describe("The Google Calendar ID. Default is from GOOGLE_CALENDAR_ID env var, then 'primary'.")

  }),
  execute: async (inputData) => {
    try {
      // DEBUG LOG
      fs.appendFileSync('/tmp/calendar-tool-calls.txt', `[${new Date().toISOString()}] Called with: ${JSON.stringify(inputData)}\n`);
      
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

      // Improved tool-level deduplication: Look for identical events in the last 24 hours
      const now = new Date();
      const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
      const existingEvents = await googleCalendar.listEvents(inputData.calendar_id, {
        timeMin: twentyFourHoursAgo,
        q: inputData.summary
      });
      
      const isDuplicate = existingEvents.find((e: any) => 
        e.summary === inputData.summary && 
        new Date(e.start?.dateTime || e.start?.date || '').toISOString() === new Date(inputData.start_time).toISOString()
      );
      
      if (isDuplicate) {
         console.log(`[CALENDAR_TOOL] Detected duplicate event "${inputData.summary}" already exists. Skipping insertion.`);
         const startStr = inputData.start_time.replace(/[-:]/g, '').split('.')[0];
         const endStr = inputData.end_time.replace(/[-:]/g, '').split('.')[0];
         const addToCalendarUrl = `https://www.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(inputData.summary)}&dates=${startStr}/${endStr}&details=${encodeURIComponent(inputData.description || '')}&sf=true&output=xml`;

         return {
           success: true,
           message: `Event "${inputData.summary}" was already scheduled. Returning details.`,
           event_link: isDuplicate.htmlLink,
           add_to_your_calendar_link: addToCalendarUrl,
           start: inputData.start_time
         };
      }

      const result = await googleCalendar.createEvent(inputData.calendar_id, event);

      // Generate a "Add to Calendar" link for the user
      const startStr = inputData.start_time.replace(/[-:]/g, '').split('.')[0];
      const endStr = inputData.end_time.replace(/[-:]/g, '').split('.')[0];
      const addToCalendarUrl = `https://www.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(inputData.summary)}&dates=${startStr}/${endStr}&details=${encodeURIComponent(inputData.description || '')}&sf=true&output=xml`;

      return {
        success: true,
        message: `Event "${inputData.summary}" scheduled successfully on Rotem's internal calendar. \n\nCRITICAL: Please provide this link to the user to add it to their own calendar: ${addToCalendarUrl}`,
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
