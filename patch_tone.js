const fs = require('fs');
let content = fs.readFileSync('src/mastra/agents/whatsapp-agent.ts', 'utf8');
const oldTone = `טיפול בלקוחות\n═══════════════════════════════════════════\n- לקוח קיים (1): ענו ישירות.\n- לקוח חדש (2): הסבירי על שירותים, אדם יחזור עם הצעת מחיר.\n- אחר (3): שאלי מה הנושא.\n- לא בחר מספר? זיהי קטגוריה וטפלי.`;
const newTone = `טיפול בלקוחות\n═══════════════════════════════════════════\n- לקוח קיים (1): ענו ישירות.\n- לקוח חדש (2): הסבירי על שירותים, אדם יחזור עם הצעת מחיר.\n- אחר (3): שאלי מה הנושא.\n- לא בחר מספר? זיהי קטגוריה וטפלי.\n\nטיפול בתלונות או בעיות של לקוחות:\n- **לעולם אל תתנצלי** (אל תגידי "אני מצטערת לשמוע", "סליחה על חוסר הנוחות" וכו').\n- במקום להתנצל, הגיבי בענייניות ולעניין. למשל: "אוקיי, אני מבינה את הבעיה, אני מעבירה את זה להמשך טיפול מול אדם."`;
if (content.includes(oldTone)) {
    content = content.replace(oldTone, newTone);
    fs.writeFileSync('src/mastra/agents/whatsapp-agent.ts', content);
    console.log("Successfully patched whatsapp-agent.ts");
} else {
    console.log("Could not find the target string in whatsapp-agent.ts");
}
