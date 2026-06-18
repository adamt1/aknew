import { writeFileSync } from 'fs';

async function main() {
  const url = 'https://2-si.co.il/bn5-gtfvr';
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      }
    });
    const text = await res.text();
    writeFileSync('scripts/page.html', text);
    console.log('HTML written to page.html');
  } catch (e) {
    console.error('Error:', e);
  }
}
main();
