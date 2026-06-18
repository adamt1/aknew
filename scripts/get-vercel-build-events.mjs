import { readFileSync } from 'fs';

async function main() {
  try {
    const authData = JSON.parse(readFileSync('/Users/adamtayar/Library/Application Support/com.vercel.cli/auth.json', 'utf8'));
    const token = authData.token;
    if (!token) {
      console.error('No Vercel token found.');
      return;
    }

    const deploymentId = 'dpl_6953Jw3uebvcZnk3croBHZFgezo2';
    const teamId = 'team_oZa5jm1X3V77fR88yvDH7fY5';
    const url = `https://api.vercel.com/v2/deployments/${deploymentId}/events?teamId=${teamId}`;

    console.log('Fetching deployment events from:', url);
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!res.ok) {
      console.error(`Vercel API failed (${res.status}):`, await res.text());
      return;
    }

    const events = await res.json();
    console.log(`Found ${events.length} events:`);
    
    // Sort and print event messages
    events.forEach(event => {
      const payload = event.payload || {};
      const text = payload.text || event.text || '';
      console.log(`[${event.type || 'LOG'}] ${text}`);
    });

  } catch (e) {
    console.error('Error:', e);
  }
}

main();
