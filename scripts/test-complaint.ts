import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { mastra } from '../src/mastra';

async function testComplaint() {
  const agent = mastra.getAgent('whatsapp-agent');
  
  const customerName = 'חנה';
  const customerChatId = '972541234567@c.us';
  const dateStrHe = 'יום ראשון, 14 ביוני 2026';
  const serverTimeHe = '21:00';
  
  const authInstructions = `
    ⛔ כלל ברזל עליון: ענו אך ורק על מה שנשאלת בהודעה הנוכחית. לא יותר. לא מידע נוסף, לא תזכורות, לא סיכומים, לא "אגב".
    - היום ${dateStrHe}. שעה: ${serverTimeHe}.
    - כל שורה מתחילה ב-RLM (\u200F).
    - טון לבבי ושירותי 😊✨. **פני תמיד ללקוח אך ורק בשמו הפרטי** (ללא שם משפחה, תארים או תוספות ארוכות) ופתחי בברכה חמה.
    - **הצגה עצמית ללקוחות (לא אדם)**: פתחי כל תשובה ללקוח בפורמט: "היי ${customerName}, אני רותם, הנציגה הדיגיטלית של איי קיי חברת ניקיון ואחזקה 😊✨" — ואז המשיכי לתשובה עצמה.
    - **זיהוי שולח ההודעה (חובה)**:
      - שם איש קשר מאומת (שם פרטי): "${customerName}".
      - **השם המאומת (השם הפרטי) הוא תמיד מקור האמת.** פני תמיד לשולח לפיו.
    - ה-chat_id של אדם (עבור scheduleReminder) הוא: "972526672663@c.us".
    - אדם (Owner): לא — זה לקוח או עובד. ה-chat_id של הלקוח הנוכחי שעמו את מדברת הוא: "${customerChatId}".
  `;

  const complaintText = 'היי אדם אני שוב מבקשת שתנקו את פחי האשפה מבפנים וגם בחוץ כולל הפח הכתום הם מסריחים. לא טופלו מזמן למרות בקשות יש לנו צינור וגם חומרי ניקוי. לטיפולך הדחוף';
  
  console.log('--- TESTING CLIENT COMPLAINT ROUTING & RESPONSE ---');
  console.log('Input Text:', complaintText);

  const result = await agent.generate(complaintText, {
    context: [
      { role: 'system', content: authInstructions }
    ]
  });

  console.log('\n--- AGENT RESPONSE ---');
  console.log(result.text);

  console.log('\n--- TOOL CALLS ---');
  console.log(JSON.stringify(result.toolResults, null, 2));

  // Assertions
  const hasHandlingText = result.text.includes('מטפלת') && result.text.includes('אדם');
  const hasReminderCall = Array.isArray(result.toolResults) && result.toolResults.some((r: any) => {
    return r.payload?.toolName === 'scheduleReminder' && r.payload?.result?.success === true;
  });

  console.log('\n--- ASSERTIONS ---');
  console.log(`Response mentions handling & transferring to Adam: ${hasHandlingText ? 'PASS ✅' : 'FAIL ❌'}`);
  console.log(`Tool call scheduleReminder triggered: ${hasReminderCall ? 'PASS ✅' : 'FAIL ❌'}`);
}

testComplaint().catch(console.error);
