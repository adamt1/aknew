import { mastra } from "@/mastra";
import { getHistory, saveMessage, isBotActive, setBotStatus } from "@/lib/supabase";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { messages, threadId = "default-thread", isHuman = false } = await req.json();

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json(
        { error: "Messages array is required" },
        { status: 400 }
      );
    }

    // If human intervenes, disable bot for this thread
    if (isHuman) {
      await setBotStatus(threadId, false);
      return NextResponse.json({ status: "bot_disabled" });
    }

    // Check if bot is active
    const active = await isBotActive(threadId);
    if (!active) {
      return NextResponse.json({ status: "bot_bypassed", content: "Agent is inactive due to human intervention." });
    }

    const agent = mastra.getAgent("whatsapp-agent");
    const lastMessage = messages[messages.length - 1].content;

    // Save user message
    await saveMessage(threadId, "user", lastMessage);

    // Fetch history for context
    const history = await getHistory(threadId);
    const context = history.map((h: any) => ({
      role: h.role,
      content: h.content,
    }));

    // Generate response with context
    const result = await agent.generate(context);

    // Save assistant response
    await saveMessage(threadId, "assistant", result.text);

    return NextResponse.json({
      role: "assistant",
      content: result.text,
    });
  } catch (error: any) {
    console.error("Chat API Error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
