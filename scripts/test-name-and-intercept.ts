function getFirstName(name: string): string {
  if (!name) return '';
  let cleanName = name.trim();
  const titlePattern = /^(רו"ח|עו"ד|ד"ר|מר|גב'|רואה\s+חשבון|עורך\s+דין|דוקטור|הצדיק|הרב)\s+/i;
  cleanName = cleanName.replace(titlePattern, '');
  
  const parts = cleanName.split(/\s+/);
  return parts[0] || '';
}

function testNames() {
  const cases = [
    { input: 'אייל רואה חשבון משרד אסרף', expected: 'אייל' },
    { input: 'שמעון קוסמוס חומרי ניקיון', expected: 'שמעון' },
    { input: 'נחמן ועד בית ששת הימים 11/ברנר', expected: 'נחמן' },
    { input: 'רו"ח אייל אסרף', expected: 'אייל' },
    { input: 'עו"ד משה כהן', expected: 'משה' },
    { input: 'ד"ר לוי', expected: 'לוי' },
    { input: 'אדם', expected: 'אדם' },
    { input: 'רואה חשבון יוסף', expected: 'יוסף' }
  ];

  console.log('--- TESTING NAME CLEANING ---');
  for (const c of cases) {
    const result = getFirstName(c.input);
    const pass = result === c.expected;
    console.log(`Input: "${c.input}" => Got: "${result}" (Expected: "${c.expected}") -> ${pass ? 'PASS ✅' : 'FAIL ❌'}`);
  }
}

function testInterception() {
  const cases = [
    {
      text: "שלום, קיבלת מסמך לחתימה מאסרף, שמואל רואי חשבון ושות'. https://2-si.co.il/bn5-gtfvr",
      expected: true
    },
    {
      text: "הנה הלינק לכתבה https://news.com/123",
      expected: false
    },
    {
      text: "שלחת לי את המסמך אתמול",
      expected: false
    },
    {
      text: "הקובץ נמצא בקישור הבא: https://drive.google.com/file/123",
      expected: true
    }
  ];

  console.log('\n--- TESTING INTERCEPTION REGEX ---');
  for (const c of cases) {
    const hasUrl = c.text && /(https?:\/\/[^\s]+)/gi.test(c.text);
    // Reset regex index if needed, but since it's inline it's fine.
    const hasDocKeywords = c.text && /(מסמך|קובץ|חתימה|חוזה|טופס)/gi.test(c.text);
    const isDocumentLink = !!(hasUrl && hasDocKeywords);
    const pass = isDocumentLink === c.expected;
    console.log(`Text: "${c.text.substring(0, 50)}..." => IsDocLink: ${isDocumentLink} (Expected: ${c.expected}) -> ${pass ? 'PASS ✅' : 'FAIL ❌'}`);
  }
}

testNames();
testInterception();
