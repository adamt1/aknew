import { greenApi } from '../lib/green-api';
import dotenv from 'dotenv';
import path from 'path';

// Load env from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const PASSOVER_MESSAGE = `\u200Fחג פסח שמח ומבורך! 🌸  
\u200Fמאחלים לכם חג מלא שמחה, חירות ואחדות. שתמיד תהיו מוקפים באהבה ובניקיון מושלם, בדיוק כמו שאנחנו דואגים לכם.  
\u200Fבברכה חמה,  
\u200Fאדם וצוות איי קיי חברת ניקיון ואחזקה🧹✨`;

async function broadcast() {
  const isLive = process.argv.includes('--live');
  
  // FINAL VERIFIED LIST of names found in the contacts
  const manualNames = [
    "יונתן ביטוח משרד",
    "אייל משרד אסרף",
    "לירן משרד פארטו",
    "נועם משרד מינרקו",
    "חנה שחם ועד בית דיזיונגוף",
    "דוד רשף רואה חשבון משרד",
    "אלמוגית משרד קאדרון",
    "ריקי הנהלת חשבונות שר טכנולגיות משרד",
    "נחמן ועד בית ששת הימים 11/ברנר",
    "ג׳יקי עו״ד",
    "דליה צור ועד בית ברנר 10",
    "אורלי משרד טופז טורס",
    "מורן משרד נובו",
    "אפרת מייטלס",
    "מעוז  אל. בי. אל. משרד",
    "אברהם  טופז משרד סמילנסקי"
  ];

  console.log(`🚀 Starting Passover Broadcast (V7 - Final Verified List)`);
  console.log(`🔄 Mode: ${isLive ? 'LIVE' : 'DRY RUN'}`);

  try {
    console.log('📡 Fetching full contacts list...');
    const allContacts = await greenApi.getContacts();
    console.log(`✅ Loaded ${allContacts.length} names from WhatsApp.`);

    const targets: any[] = [];
    const notFound: string[] = [];

    manualNames.forEach(nameToMatch => {
        // Use exact match with some trimming to be safe
        const match = allContacts.find((c: any) => 
            (c.name || '').toLowerCase().trim() === nameToMatch.toLowerCase().trim()
        );
        if (match) {
            targets.push(match);
        } else {
            // Partial match attempt if exact fails
            const partial = allContacts.find((c: any) => {
                const cn = (c.name || '').toLowerCase().trim();
                if (!cn || cn.length < 3) return false;
                return cn.includes(nameToMatch.toLowerCase().trim()) ||
                       nameToMatch.toLowerCase().trim().includes(cn);
            });
            if (partial) {
                targets.push(partial);
            } else {
                notFound.push(nameToMatch);
            }
        }
    });

    // Remove duplicates if any
    const uniqueTargets = Array.from(new Map(targets.map(item => [item.id, item])).values());

    console.log(`\n🎯 TARGETS LOCKED (${uniqueTargets.length} contacts):`);
    uniqueTargets.forEach((t: any, i: number) => {
      console.log(`${i + 1}. [${t.id}] ${t.name || 'No Name'}`);
    });

    if (notFound.length > 0) {
        console.log(`\n⚠️  Names NOT found in contacts (${notFound.length}):`);
        notFound.forEach(n => console.log(`   - ${n}`));
    }

    if (!isLive) {
      console.log(`\n⚠️  This was a DRY RUN for ${uniqueTargets.length} targets. Use "--live" to actually send messages.`);
      return;
    }

    if (uniqueTargets.length === 0) {
      console.log('❌ No matching contacts found. Nothing to send.');
      return;
    }

    console.log('\n‼️  LIVE BROADCAST STARTING IN 3 SECONDS...');
    await new Promise(r => setTimeout(r, 3000));

    for (let i = 0; i < uniqueTargets.length; i++) {
        const contact = uniqueTargets[i];
        console.log(`[${i + 1}/${uniqueTargets.length}] Sending to ${contact.name}...`);
        
        try {
          await greenApi.sendMessage(contact.id, PASSOVER_MESSAGE);
          console.log('   ✅ Sent.');
        } catch (e: any) {
          console.error(`   ❌ Failed: ${e.message}`);
        }
  
        // 2 second delay between messages to avoid spam detection
        if (i < uniqueTargets.length - 1) {
          await new Promise(r => setTimeout(r, 2000));
        }
      }
  
      console.log('\n🏁 Broadcast completed successfully!');
    } catch (error: any) {
      console.error('💥 Error during broadcast:', error);
    }
}

broadcast();
