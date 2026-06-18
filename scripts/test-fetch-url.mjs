async function main() {
  const url = 'https://2-si.co.il/bn5-gtfvr';
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      }
    });
    console.log('Status:', res.status);
    console.log('Headers:', Object.fromEntries(res.headers.entries()));
    const text = await res.text();
    console.log('Length:', text.length);
    console.log('Preview:', text.substring(0, 1000));
  } catch (e) {
    console.error('Error fetching URL:', e);
  }
}
main();
