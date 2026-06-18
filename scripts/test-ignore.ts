function shouldIgnoreResponse(replyText: string): boolean {
  const cleanedReply = replyText.replace(/[\u200F\u200E\s\t\n\r]/g, '').replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"']/g, '').trim();
  const shouldIgnore = 
    cleanedReply.length === 0 ||
    replyText.includes('[IGNORE]') || 
    replyText.toLowerCase().includes('no response needed') || 
    replyText.toLowerCase().includes('ignore');
  
  console.log(`Input: ${JSON.stringify(replyText)}`);
  console.log(`Cleaned: ${JSON.stringify(cleanedReply)} (length: ${cleanedReply.length})`);
  console.log(`Should Ignore: ${shouldIgnore}`);
  console.log('---');
  return shouldIgnore;
}

function runTests() {
  shouldIgnoreResponse('\u200F');
  shouldIgnoreResponse('\u200F\n');
  shouldIgnoreResponse('\u200F[IGNORE]');
  shouldIgnoreResponse('\u200Fignore');
  shouldIgnoreResponse('\u200Fno response needed');
  shouldIgnoreResponse('\u200Fתודה רבה 😊');
  shouldIgnoreResponse('תודה.');
}

runTests();
