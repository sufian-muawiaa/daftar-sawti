/* =========================================================
   دفتر الديون الصوتي — tests/parser.test.js
   حزمة اختبارات آلية لمحرك تحويل الأرقام وتحليل الأوامر الصوتية.
   لا تحتاج أي حزمة خارجية (لا Jest ولا Mocha) — فقط:
     node tests/parser.test.js
   تخرج بكود 0 عند نجاح كل الاختبارات، وكود 1 عند فشل أي منها
   (مناسبة مباشرة للربط مع CI عبر GitHub Actions، راجع .github/workflows/).
   ========================================================= */
"use strict";
const path = require('path');
const { normalizeArabic, wordsToNumber, parseCommand } = require(path.join(__dirname, '..', 'parser.js'));

let passed = 0, failed = 0;
const failures = [];

function eq(actual, expected, label){
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if(ok){ passed++; }
  else{
    failed++;
    failures.push({label, actual, expected});
  }
  console.log(`${ok ? '✓' : '✗'} ${label}`);
  if(!ok){
    console.log(`    توقعت: ${JSON.stringify(expected)}`);
    console.log(`    حصلت:  ${JSON.stringify(actual)}`);
  }
}

console.log('\n=== محرك تحويل الأرقام العربية (wordsToNumber) ===\n');

const numberCases = [
  ["خمسون ألف", 50000],
  ["خمسة وعشرون ألف", 25000],
  ["عشرون ألف", 20000],
  ["مئة ألف", 100000],
  ["مائة ألف", 100000],
  ["مليون", 1000000],
  ["مليون ونصف", 1500000],
  ["ألفين", 2000],
  ["الفين", 2000],
  ["خمسة آلاف", 5000],
  ["عشرة آلاف", 10000],
  ["ثلاثمئة وخمسة وعشرون ألف", 325000],
  ["مليون وخمسمئة ألف", 1500000],
  ["50000", 50000],
  ["ثلاثة آلاف وخمسمئة", 3500],
  ["مليونين", 2000000],
  ["تسعة عشر ألف", 19000],
  ["عشرة", 10],
  ["واحد", 1],
  ["صفر", 0],
  ["مئتان وخمسون ألف", 250000],
  ["أربعمئة ألف", 400000],
];
numberCases.forEach(([phrase, expected])=>{
  eq(wordsToNumber(phrase), expected, `"${phrase}" => ${expected}`);
});

console.log('\n=== محرك تحليل الأوامر الصوتية (parseCommand) ===\n');

const cmdCases = [
  {
    input: "محمد إضافة خمسين ألف",
    expected: {kind:'transaction', name:'محمد', type:'add', amount:50000}
  },
  {
    input: "محمد أضف خمسين ألف",
    expected: {kind:'transaction', name:'محمد', type:'add', amount:50000}
  },
  {
    input: "محمد طرح عشرين ألف",
    expected: {kind:'transaction', name:'محمد', type:'subtract', amount:20000}
  },
  {
    input: "محمد دفع عشرين ألف",
    expected: {kind:'transaction', name:'محمد', type:'subtract', amount:20000}
  },
  {
    input: "محمد سدد عشرين ألف",
    expected: {kind:'transaction', name:'محمد', type:'subtract', amount:20000}
  },
  {
    input: "اطرح من محمد عشرة آلاف",
    expected: {kind:'transaction', name:'محمد', type:'subtract', amount:10000}
  },
  {
    input: "افتح صفحة محمد",
    expected: {kind:'open', name:'محمد'}
  },
  {
    input: "كم دين محمد",
    expected: {kind:'query', name:'محمد'}
  },
];

cmdCases.forEach(({input, expected})=>{
  const got = parseCommand(input);
  // نقارن فقط الحقول المتوقعة (نتجاهل raw/items/إلخ) لتجنّب اختبارات هشة
  const trimmed = {};
  Object.keys(expected).forEach(k=> trimmed[k] = got[k]);
  eq(trimmed, expected, `"${input}"`);
});

console.log('\n=== حالات حدّية (edge cases) ===\n');

eq(wordsToNumber("كلام غير مفهوم بدون أرقام"), null, 'نص بلا أي رقم يُرجع null');
eq(parseCommand("").kind, 'unknown', 'نص فارغ يُرجع kind=unknown');
eq(normalizeArabic("مِئَة") , normalizeArabic("مئة"), 'التشكيل لا يؤثر على التطبيع');

console.log(`\n${'='.repeat(50)}`);
console.log(`النتيجة: ${passed} نجح، ${failed} فشل، من أصل ${passed+failed}`);
console.log('='.repeat(50));

if(failed > 0){
  console.log('\nتفاصيل الاختبارات الفاشلة:');
  failures.forEach(f=> console.log(`  - ${f.label}`));
  process.exit(1);
} else {
  console.log('\n✅ كل الاختبارات ناجحة.');
  process.exit(0);
}
