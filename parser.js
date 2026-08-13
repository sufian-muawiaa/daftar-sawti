/* =========================================================
   دفتر الديون الصوتي — parser.js
   محرك تحويل الأرقام العربية المنطوقة وتحليل الأوامر الصوتية.
   وحدة مستقلة تماماً بلا أي اعتماد على DOM أو localStorage،
   حتى يمكن اختبارها آلياً عبر Node.js (راجع tests/parser.test.js)
   وإعادة استخدامها لاحقاً في أي واجهة أخرى (تطبيق جوال أصلي، خادم...).
   ========================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(); // Node.js / CommonJS (للاختبارات)
  } else {
    root.DaftarParser = factory(); // المتصفح
  }
}(typeof self !== 'undefined' ? self : this, function () {
  "use strict";

  /* ============ تطبيع النص العربي ============ */
  const AR_DIGITS = {'٠':'0','١':'1','٢':'2','٣':'3','٤':'4','٥':'5','٦':'6','٧':'7','٨':'8','٩':'9'};

  function normalizeArabic(s){
    return String(s)
      .replace(/[٠-٩]/g, d => AR_DIGITS[d])
      .replace(/[إأآا]/g,'ا')
      .replace(/ى/g,'ي')
      .replace(/ة/g,'ه')
      .replace(/ؤ/g,'و')
      .replace(/ئ/g,'ي')
      .replace(/[\u064B-\u0652]/g,'') // تشكيل
      .replace(/ـ/g,'')
      .replace(/[،,]/g,' , ')
      .replace(/\s+/g,' ')
      .trim();
  }

  // نبني القواميس من التهجئة العربية الطبيعية ثم نمررها عبر normalizeArabic
  // حتى تتطابق المفاتيح مع شكل النص بعد التطبيع تلقائياً (بدل كتابتها يدوياً وقد تتعارض
  // مع تحويلات مثل ئ→ي أو ة→ه).
  function buildNumMap(pairs){
    const map = {};
    pairs.forEach(([w,v])=>{ map[normalizeArabic(w)] = v; });
    return map;
  }

  const ONES = buildNumMap([['صفر',0],['واحد',1],['واحدة',1],['اثنان',2],['اثنين',2],['ثلاثة',3],['ثلاث',3],
    ['أربعة',4],['اربعة',4],['أربع',4],['اربع',4],['خمسة',5],['خمس',5],['ستة',6],['ست',6],['سبعة',7],['سبع',7],
    ['ثمانية',8],['ثمان',8],['تسعة',9],['تسع',9]]);
  const TEENS = buildNumMap([['عشرة',10],['أحد عشر',11],['احد عشر',11],['اثنا عشر',12],['اثني عشر',12],
    ['ثلاثة عشر',13],['أربعة عشر',14],['اربعة عشر',14],['خمسة عشر',15],['ستة عشر',16],['سبعة عشر',17],
    ['ثمانية عشر',18],['تسعة عشر',19]]);
  const TENS = buildNumMap([['عشرون',20],['عشرين',20],['ثلاثون',30],['ثلاثين',30],['أربعون',40],['اربعون',40],
    ['أربعين',40],['اربعين',40],['خمسون',50],['خمسين',50],['ستون',60],['ستين',60],['سبعون',70],['سبعين',70],
    ['ثمانون',80],['ثمانين',80],['تسعون',90],['تسعين',90]]);
  const HUNDREDS = buildNumMap([['مئة',100],['مائة',100],['مئتان',200],['مئتين',200],['ثلاثمئة',300],['ثلاثمائة',300],
    ['أربعمئة',400],['اربعمئة',400],['خمسمئة',500],['ستمئة',600],['سبعمئة',700],['ثمانمئة',800],['تسعمئة',900]]);
  const SPECIAL = buildNumMap([['ألفين',2000],['الفين',2000],['مليونان',2000000],['مليونين',2000000]]);
  const SCALE = buildNumMap([['ألف',1000],['الف',1000],['آلاف',1000],['الاف',1000],['مليون',1000000],['ملايين',1000000]]);
  const NISF = normalizeArabic('نصف');

  // يحاول مطابقة رمز واحد ضمن حالة التراكم الحالية؛ يُرجع true إذا تم التعرف عليه
  function tryMatchNumToken(tok, state){
    if(/^\d+$/.test(tok)){ state.current += parseInt(tok,10); return true; }
    // بعض المتصفحات (حسب لغة نظام التشغيل، مثل التركية) تكتب الأرقام المنطوقة
    // بصيغة "50.000" (نقطة كفاصل آلاف) بدل "50000" — نتعامل معها هنا
    if(/^\d{1,3}(\.\d{3})+$/.test(tok)){ state.current += parseInt(tok.replace(/\./g,''),10); return true; }
    if(tok === NISF){ if(state.lastScale){ state.total += state.lastScale/2; } return true; }
    if(TEENS[tok] !== undefined){ state.current += TEENS[tok]; return true; }
    if(SPECIAL[tok] !== undefined){ state.total += SPECIAL[tok]; return true; }
    if(HUNDREDS[tok] !== undefined){ state.current += HUNDREDS[tok]; return true; }
    if(TENS[tok] !== undefined){ state.current += TENS[tok]; return true; }
    if(ONES[tok] !== undefined){ state.current += ONES[tok]; return true; }
    if(SCALE[tok] !== undefined){
      const mult = SCALE[tok];
      const base = state.current === 0 ? 1 : state.current;
      const val = base * mult;
      state.total += val;
      state.lastScale = val;
      state.current = 0;
      return true;
    }
    return false;
  }

  function wordsToNumber(phrase){
    let text = normalizeArabic(phrase);
    // دمج صيغ العشرات المركبة (أحد عشر...الخ) إلى رمز واحد قبل التقسيم
    Object.keys(TEENS).forEach(k=>{
      if(k.includes(' ')) text = text.replace(new RegExp(k,'g'), k.replace(/ /g,'_'));
    });
    const rawTokens = text.split(/\s+/).filter(Boolean);
    const state = {total:0, current:0, lastScale:0};
    let matchedAny = false;

    for(let raw of rawTokens){
      const tok = raw.replace(/_/g,' ');
      if(tok === 'و' || tok === ',') continue;
      let ok = tryMatchNumToken(tok, state);
      // حرف الواو في العربية يُكتب غالباً ملتصقاً بالكلمة التالية بلا مسافة
      // (وعشرون، وخمسمئة، ونصف...) فنجرّب إزالته إن فشلت المطابقة المباشرة
      if(!ok && tok.startsWith('و') && tok.length > 1){
        ok = tryMatchNumToken(tok.slice(1), state);
      }
      if(ok) matchedAny = true;
      // كلمة غير معروفة تُتجاهل بصمت (قد تكون "ليرة"، "ل.س"، إلخ)
    }
    state.total += state.current;
    return matchedAny ? state.total : null;
  }

  /* ============ محرك تحليل الأوامر الصوتية ============ */
  const ADD_WORDS = ['اضافه','أضف','اضف','زاد','زياده','عليه','اشترى','اشتري','اخذ','أخذ'];
  const SUB_WORDS = ['طرح','اطرح','دفع','سدد','نقص','تنزيل','خصم','اعطى','اعطي'];
  const OPEN_WORDS = ['افتح','صفحه','اذهب الى','اذهب الي'];
  const STRIP_WORDS = ['صفحه','ليره','سوريه','ل.س','لس','ل س'];

  function stripNoise(s){
    let t = s;
    STRIP_WORDS.forEach(w=>{ t = t.replace(new RegExp('\\b'+w+'\\b','g'),' '); });
    return t.replace(/\s+/g,' ').trim();
  }

  // يحاول إيجاد أول كلمة عملية (إضافة/طرح) ضمن النص ويرجع فهرسها والنوع
  function findActionWord(tokens){
    for(let i=0;i<tokens.length;i++){
      const t = tokens[i];
      if(ADD_WORDS.includes(t)) return {index:i, type:'add', word:t};
      if(SUB_WORDS.includes(t)) return {index:i, type:'subtract', word:t};
    }
    return null;
  }

  function parseCommand(rawText){
    const norm = normalizeArabic(rawText);
    const cleaned = stripNoise(norm);
    const tokens = cleaned.split(/\s+/).filter(Boolean);

    // أمر استعلام: "كم دين محمد"
    if(/^كم (دين|رصيد)/.test(cleaned)){
      const name = cleaned.replace(/^كم (دين|رصيد)/,'').trim();
      return {kind:'query', name: name || null};
    }
    // أمر فتح صفحة بدون عملية مالية: "افتح صفحة محمد" أو "صفحة محمد"
    const action = findActionWord(tokens);
    if(!action){
      let name = cleaned;
      OPEN_WORDS.forEach(w=>{ name = name.replace(new RegExp('^'+w+'\\s*','g'),''); });
      name = name.trim();
      if(name) return {kind:'open', name};
      return {kind:'unknown', raw: rawText};
    }

    let namePart = tokens.slice(0, action.index).join(' ').trim();
    let amountPart = tokens.slice(action.index+1).join(' ').trim();

    // نمط "اطرح من محمد عشرة آلاف": الاسم يأتي بعد الفعل مباشرة مسبوقاً بـ"من"
    if(!namePart){
      const afterTokens = tokens.slice(action.index+1);
      if(afterTokens[0] === 'من' && afterTokens[1]){
        namePart = afterTokens[1];
        amountPart = afterTokens.slice(2).join(' ').trim();
      }
    }

    // عناصر متعددة مفصولة بفواصل: "سكر عشرين ألف , رز خمسة عشر ألف"
    let items = [];
    let totalAmount = 0;
    if(amountPart.includes(',')){
      const segs = amountPart.split(',').map(s=>s.trim()).filter(Boolean);
      for(const seg of segs){
        const num = wordsToNumber(seg);
        if(num !== null){
          // استخراج اسم الصنف: أزل الكلمات الرقمية من القطعة
          let itemName = seg;
          Object.keys(ONES).concat(Object.keys(TENS),Object.keys(HUNDREDS),Object.keys(SCALE),Object.keys(SPECIAL),[NISF])
            .forEach(w=>{ itemName = itemName.replace(new RegExp('\\b'+w+'\\b','g'),''); });
          itemName = itemName.replace(/\s+/g,' ').trim();
          items.push({name:itemName || 'صنف', amount:num});
          totalAmount += num;
        }
      }
    } else {
      const num = wordsToNumber(amountPart);
      totalAmount = num || 0;
    }

    return {
      kind:'transaction',
      name: namePart,
      type: action.type,
      amount: totalAmount,
      items,
      raw: rawText
    };
  }

  return {
    normalizeArabic,
    wordsToNumber,
    parseCommand,
    // نصدّرها أيضاً لأغراض الاختبار المتقدم إن لزم لاحقاً
    _internal: { ONES, TEENS, TENS, HUNDREDS, SPECIAL, SCALE }
  };
}));
