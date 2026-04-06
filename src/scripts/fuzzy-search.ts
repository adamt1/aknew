import { greenApi, GreenContact } from '../lib/green-api';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const missing = [
  "ריקי הנהלת חשבונות שר טכנולוגיות משרד",
  "שמואל ועד בית ששת הימים",
  "אפרת ועד בית מייטלס",
  "מעוז אל.בי. אל משרד",
  "אברהם טופז משרד סמילנסקי"
];

// Keywords to try for each
const keywords = [
    ["ריקי", "שר"],
    ["שמואל", "ששת"],
    ["אפרת", "מייטלס"],
    ["מעוז", "אל.בי"],
    ["אברהם", "סמילנסקי", "טופז"]
];

async function fuzzySearch() {
  try {
    const allContacts = await greenApi.getContacts();
    console.log(`Searching through ${allContacts.length} contacts...\n`);

    keywords.forEach((keys, idx) => {
        console.log(`🔍 Searching for: ${missing[idx]}`);
        const matches = allContacts.filter((c: GreenContact) => {
            const name = (c.name || '').toLowerCase();
            // Match if ALL keywords for this person are in the name
            return keys.every(k => name.includes(k.toLowerCase()));
        });

        if (matches.length > 0) {
            matches.forEach((m: GreenContact) => console.log(`   ✅ Found: [${m.id}] ${m.name}`));
        } else {
            console.log(`   ❌ No match for keywords: ${keys.join(', ')}`);
            // Try single keyword if combined failed
            console.log(`   🧪 Trying single keywords individually...`);
            keys.forEach(k => {
                const singleMatches = allContacts.filter((c: GreenContact) => (c.name || '').toLowerCase().includes(k.toLowerCase()));
                if (singleMatches.length > 0 && singleMatches.length < 5) {
                    singleMatches.forEach((m: GreenContact) => console.log(`      💡 Potential (by "${k}"): [${m.id}] ${m.name}`));
                }
            });
        }
        console.log('');
    });
  } catch (e) {
    console.error(e);
  }
}

fuzzySearch();
