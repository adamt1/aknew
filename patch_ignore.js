const fs = require('fs');

// Patch whatsapp-agent.ts
let agentContent = fs.readFileSync('src/mastra/agents/whatsapp-agent.ts', 'utf8');
const oldIgnore = `סינון הודעות (IGNORE):\n- [IGNORE] רק עבור: Reactions טהורות (👍, ❤️ וכד'), הודעה שהיא אך ורק "תודה" / "אוקיי" / "סבבה" ללא תוכן נוסף.\n- **חובה לענות** לכל הודעה שמכילה: עדכון, שאלה, דאגה, מידע, בקשה — גם אם נסגרת ב"שיהיה שבוע טוב" או ברכה דומה. קראי את כל ההודעה, ענו על התוכן האמיתי שלה בצורה עניינית וחמה.`;
const newIgnore = `סינון הודעות (IGNORE):\n- **סילוק הודעות (התעלמות)**: התעלמי מהודעות שהן אך ורק Reactions (👍, ❤️ וכד'), או הודעה שהיא אך ורק "תודה", "תודה רבה", "אוקיי", "סבבה" ללא שום בקשה או מידע נוסף.\n- **אם החלטת לסנן (להתעלם)**: עליך להחזיר בתשובתך אך ורק את המילה [IGNORE] (עם סוגריים מרובעים), בדיוק כך. **אסור** בשום אופן להחזיר משפטים כמו "No response needed" או הסברים באנגלית. רק [IGNORE].\n- **חובה לענות** לכל הודעה שמכילה: עדכון, שאלה, דאגה, מידע, בקשה — גם אם נסגרת ב"שיהיה שבוע טוב" או ברכה דומה. קראי את כל ההודעה, ענו על התוכן האמיתי שלה בצורה עניינית וחמה.`;
agentContent = agentContent.replace(oldIgnore, newIgnore);
fs.writeFileSync('src/mastra/agents/whatsapp-agent.ts', agentContent);

// Patch route.ts
let routeContent = fs.readFileSync('src/app/api/webhook/route.ts', 'utf8');
const oldRouteIgnore = `if (replyText.includes('[IGNORE]')) {`;
const newRouteIgnore = `if (replyText.includes('[IGNORE]') || replyText.toLowerCase().includes('no response needed') || replyText.toLowerCase().includes('ignore')) {`;
routeContent = routeContent.replace(oldRouteIgnore, newRouteIgnore);
fs.writeFileSync('src/app/api/webhook/route.ts', routeContent);

console.log("Patched successfully");
