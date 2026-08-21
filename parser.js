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

  // بعض متصفحات/محركات التعرف الصوتي تكتب الأرقام المنطوقة بصيغة مجمّعة
  // مثل "50,000" أو "50.000" بدل "50000" (حسب لغة نظام التشغيل). لازم نلتقط
  // هذي الحالة ونحوّلها لرقم صريح *قبل* أي معالجة أخرى، وإلا فاصلة الآلاف
  // ستُفهم بالغلط كفاصلة تفصل بين أصناف متعددة (ميزة أخرى بالتطبيق).
  function collapseGroupedNumbers(text){
    return String(text).replace(/\d{1,3}(?:[.,]\d{3})+\b/g, m => m.replace(/[.,]/g, ''));
  }

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

  // العملات المدعومة: نتعرّف على اسم العملة المنطوق بعد الرقم مباشرة
  // (مثلاً "مئتين دولار") ونحدد رمز العملة القياسي (ISO). الليرة السورية
  // هي الافتراضية دائماً إن لم يُذكر اسم عملة صراحةً.
  const DEFAULT_CURRENCY = 'SYP';
  const CURRENCY_MAP = buildNumMap([
    ['دولار','USD'],['دولارات','USD'],['دولاران','USD'],['دولارين','USD'],
    ['يورو','EUR'],['يوروهات','EUR'],
    ['ليرة','SYP'],['ليره','SYP'],['ل.س','SYP'],['لس','SYP'],['ليرة سورية','SYP'],['ليره سوريه','SYP'],
    ['ريال','SAR'],['ريالات','SAR'],['ريال سعودي','SAR'],
    ['درهم','AED'],['دراهم','AED'],['درهم اماراتي','AED'],
  ]);
  const CURRENCY_SYMBOLS = { SYP:'ل.س', USD:'$', EUR:'€', SAR:'ر.س', AED:'د.إ' };

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
    let text = normalizeArabic(collapseGroupedNumbers(phrase));
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

  // يتحقق هل رمز نصي معين يمثل رقماً معروفاً (خانة أرقام، أو كلمة عدد عربية)
  function isNumberWordToken(tok){
    if(/^\d+$/.test(tok)) return true;
    if(tok === NISF) return true;
    if(TEENS[tok] !== undefined) return true;
    if(SPECIAL[tok] !== undefined) return true;
    if(HUNDREDS[tok] !== undefined) return true;
    if(TENS[tok] !== undefined) return true;
    if(ONES[tok] !== undefined) return true;
    if(SCALE[tok] !== undefined) return true;
    // حرف الواو يُكتب غالباً ملتصقاً بالكلمة التالية بلا مسافة (وعشرون، وخمسمئة...)
    if(tok.startsWith('و') && tok.length > 1) return isNumberWordToken(tok.slice(1));
    return false;
  }

  // يحلّل جملة قد تحتوي عدة أوامر متتالية بلا فواصل صمت كافية بينها
  // مثل: "خالد إضافة خمسة آلاف عمر إضافة عشرة آلاف زيد طرح ألفين"
  // يرجع مصفوفة أوامر منفصلة، أو null إن كانت الجملة تحتوي أمراً واحداً فقط
  // (وحينها يُترك الأمر لـ parseCommand العادي بمساره المعتاد بكل ميزاته).
  function parseMultipleCommands(rawText){
    const norm = normalizeArabic(collapseGroupedNumbers(rawText));
    let text = norm;
    Object.keys(TEENS).forEach(k=>{
      if(k.includes(' ')) text = text.replace(new RegExp(k,'g'), k.replace(/ /g,'_'));
    });
    const tokens = text.split(/\s+/).filter(Boolean);

    // نحدد كل مواقع كلمات العملية (إضافة/طرح) بالجملة كاملة
    const actionAt = {}; // index -> 'add' | 'subtract'
    tokens.forEach((raw,i)=>{
      const t = raw.replace(/_/g,' ');
      if(ADD_WORDS.includes(t)) actionAt[i] = 'add';
      else if(SUB_WORDS.includes(t)) actionAt[i] = 'subtract';
    });
    const actionIdxs = Object.keys(actionAt).map(Number).sort((a,b)=>a-b);
    if(actionIdxs.length <= 1) return null; // أمر واحد أو لا شيء: نترك المعالجة لـ parseCommand

    const commands = [];
    let cursor = 0; // مؤشر عام يتحرك للأمام مع كل أمر نُعالجه

    for(let k=0;k<actionIdxs.length;k++){
      const actionIdx = actionIdxs[k];
      const type = actionAt[actionIdx];

      // نمط "الاسم قبل الفعل": كل ما بين المؤشر الحالي وموقع الفعل هو الاسم
      let name = tokens.slice(cursor, actionIdx).map(t=>t.replace(/_/g,' ')).join(' ').trim();
      let amtStart = actionIdx + 1;

      if(!name){
        // نمط "الفعل قبل الاسم" (بدون اسم قبله): اجمع الاسم من بعد الفعل
        // مباشرة طالما مو أرقام/عملة ولا فعل تالٍ — يدعم أسماء عدة كلمات
        let j = amtStart;
        const nameTokens = [];
        while(j < tokens.length && actionAt[j] === undefined){
          const tj = tokens[j].replace(/_/g,' ');
          if(isNumberWordToken(tj) || CURRENCY_MAP[tj] !== undefined) break;
          nameTokens.push(tj);
          j++;
        }
        name = nameTokens.join(' ').trim();
        amtStart = j;
      }

      // اجمع رموز المبلغ بعد نهاية الاسم طالما هي أرقام (أو كلمة وصل "و")،
      // ونتوقف فوراً عند الوصول لفعل تالٍ حتى لو بدا الرمز رقماً
      let j = amtStart;
      const amountTokens = [];
      while(j < tokens.length && actionAt[j] === undefined){
        const tj = tokens[j].replace(/_/g,' ');
        const stripped = (tj.startsWith('و') && tj.length > 1) ? tj.slice(1) : tj;
        if(tj === 'و' || isNumberWordToken(tj) || isNumberWordToken(stripped)){
          amountTokens.push(tokens[j]);
          j++;
        } else break;
      }
      const amountPhrase = amountTokens.map(t=>t.replace(/_/g,' ')).join(' ');
      const amount = wordsToNumber(amountPhrase) || 0;

      // تحقق من وجود اسم عملة مباشرة بعد الرقم (مثل "500 دولار") واستهلكه،
      // وإلا بقي معلّقاً ويلتصق بالغلط باسم الأمر التالي بالجملة
      let currency = DEFAULT_CURRENCY;
      if(j < tokens.length && actionAt[j] === undefined){
        const tj = tokens[j].replace(/_/g,' ');
        if(CURRENCY_MAP[tj] !== undefined){ currency = CURRENCY_MAP[tj]; j++; }
      }

      if(name && amount > 0){
        commands.push({name, type, amount, currency, raw: rawText});
      }
      cursor = j;
    }
    return commands.length >= 2 ? commands : null;
  }

  // يستهلك رموز الرقم من بداية النص طالما هي كلمات/أرقام معروفة، ثم يفحص
  // إن كانت الكلمة التالية اسم عملة، وأخيراً يعتبر كل ما تبقى "اسم السلعة"
  // مثال: "مئة الف معدات صحية" => {amount:100000, currency:'SYP', itemName:'معدات صحية'}
  // مثال: "مئتين دولار" => {amount:200, currency:'USD', itemName:''}
  function parseAmountCurrencyItem(phrase){
    let text = phrase;
    Object.keys(TEENS).forEach(k=>{
      if(k.includes(' ')) text = text.replace(new RegExp(k,'g'), k.replace(/ /g,'_'));
    });
    const rawTokens = text.split(/\s+/).filter(Boolean);
    const state = {total:0, current:0, lastScale:0};
    let i = 0, matchedAny = false;

    while(i < rawTokens.length){
      const tok = rawTokens[i].replace(/_/g,' ');
      if(tok === 'و' || tok === ','){ i++; continue; }
      let ok = tryMatchNumToken(tok, state);
      if(!ok && tok.startsWith('و') && tok.length > 1) ok = tryMatchNumToken(tok.slice(1), state);
      if(ok){ matchedAny = true; i++; } else break;
    }
    state.total += state.current;
    const amount = matchedAny ? state.total : 0;

    let currency = null;
    if(i < rawTokens.length){
      const nextTok = rawTokens[i].replace(/_/g,' ');
      const stripped = (nextTok.startsWith('و') && nextTok.length > 1) ? nextTok.slice(1) : nextTok;
      if(CURRENCY_MAP[nextTok] !== undefined){ currency = CURRENCY_MAP[nextTok]; i++; }
      else if(CURRENCY_MAP[stripped] !== undefined){ currency = CURRENCY_MAP[stripped]; i++; }
    }
    const itemName = rawTokens.slice(i).map(t=>t.replace(/_/g,' ')).join(' ').trim();
    return { amount, currency, itemName };
  }

  // يبحث عن أول ذكر لاسم عملة في أي مكان بالنص (لأغراض تحديد عملة العملية كاملة)
  function detectCurrency(text){
    const tokens = String(text).split(/\s+/).filter(Boolean);
    for(const raw of tokens){
      const stripped = (raw.startsWith('و') && raw.length > 1) ? raw.slice(1) : raw;
      if(CURRENCY_MAP[raw] !== undefined) return CURRENCY_MAP[raw];
      if(CURRENCY_MAP[stripped] !== undefined) return CURRENCY_MAP[stripped];
    }
    return DEFAULT_CURRENCY;
  }

  /* ============ محرك تحليل الأوامر الصوتية ============ */
  // كلمات "الإضافة" مجمّعة من الفصحى ولهجات شامية وخليجية ومصرية شائعة
  const ADD_WORDS = ['اضافه','أضف','اضف','زاد','زياده','عليه','اشترى','اشتري','اخذ','أخذ',
    'زود','ضيف','حط','سجل','سجلها','اكتب'];
  // كلمات "الطرح/الدفع" بنفس التنويع اللهجي
  const SUB_WORDS = ['طرح','اطرح','دفع','سدد','نقص','تنزيل','خصم','اعطى','اعطي',
    'دفعلي','سددلي','فك','رجع','ارجع'];
  const OPEN_WORDS = ['افتح','صفحه','اذهب الى','اذهب الي'];
  const STRIP_WORDS = ['صفحه','ليره','سوريه','ل.س','لس','ل س'];

  function stripNoise(s){
    let t = s;
    STRIP_WORDS.forEach(w=>{ t = t.replace(new RegExp('\\b'+w+'\\b','g'),' '); });
    return t.replace(/\s+/g,' ').trim();
  }

  // مسافة ليفنشتاين (عدد التعديلات الحرفية اللازمة لتحويل كلمة لأخرى) — نستخدمها
  // للتسامح مع خطأ حرف واحد بالتعرف الصوتي (فرق لهجة/نطق) بدل رفض الكلمة كلياً
  function levenshtein(a, b){
    const m = a.length, n = b.length;
    if(m === 0) return n;
    if(n === 0) return m;
    const dp = Array.from({length:m+1}, (_,i)=> [i].concat(Array(n).fill(0)));
    for(let j=0;j<=n;j++) dp[0][j] = j;
    for(let i=1;i<=m;i++){
      for(let j=1;j<=n;j++){
        dp[i][j] = a[i-1]===b[j-1] ? dp[i-1][j-1]
          : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
      }
    }
    return dp[m][n];
  }

  // يبحث عن أقرب كلمة مطابقة تقريبياً ضمن قائمة (فرق حرف واحد كحد أقصى،
  // وبطول كلمة 4 أحرف فأكثر تفادياً لمطابقات خاطئة بكلمات قصيرة)
  function fuzzyIncludes(list, tok){
    if(list.includes(tok)) return true;
    if(tok.length < 4) return false;
    return list.some(w => w.length >= 4 && Math.abs(w.length - tok.length) <= 1 && levenshtein(w, tok) === 1);
  }

  // يحاول إيجاد أول كلمة عملية (إضافة/طرح) ضمن النص ويرجع فهرسها والنوع —
  // مطابقة دقيقة أولاً، وإن لم توجد نجرّب مطابقة تقريبية (تصحيح تلقائي بسيط)
  function findActionWord(tokens){
    for(let i=0;i<tokens.length;i++){
      const t = tokens[i];
      if(ADD_WORDS.includes(t)) return {index:i, type:'add', word:t};
      if(SUB_WORDS.includes(t)) return {index:i, type:'subtract', word:t};
    }
    for(let i=0;i<tokens.length;i++){
      const t = tokens[i];
      if(fuzzyIncludes(ADD_WORDS, t)) return {index:i, type:'add', word:t, fuzzy:true};
      if(fuzzyIncludes(SUB_WORDS, t)) return {index:i, type:'subtract', word:t, fuzzy:true};
    }
    return null;
  }

  function parseCommand(rawText){
    const norm = normalizeArabic(collapseGroupedNumbers(rawText));
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
      let nameRaw = cleaned;
      OPEN_WORDS.forEach(w=>{ nameRaw = nameRaw.replace(new RegExp('^'+w+'\\s*','g'),''); });
      nameRaw = nameRaw.trim();

      // فصل صارم: أي رقم أو اسم عملة يُستبعد تمامًا من الاسم مهما كان موقعه،
      // بدل ما ينسحب بالغلط لداخل اسم الزبون (مثال: "علي 25000" لا يجوز أن
      // يصبح اسم الزبون الحرفي "علي 25000"، والرقم بلا أي معنى فيه أصلاً
      // بدون كلمة عملية مثل "إضافة" تُفسّره). نُبلّغ عن أي رقم مُتجاهَل حتى
      // تنعكس الملاحظة بالواجهة ولا يضيع شيء بصمت.
      const rawTokens = nameRaw.split(/\s+/).filter(Boolean);
      const nameTokens = [];
      const ignoredTokens = [];
      rawTokens.forEach(t=>{
        if(isNumberWordToken(t) || CURRENCY_MAP[t] !== undefined) ignoredTokens.push(t);
        else nameTokens.push(t);
      });
      const name = nameTokens.join(' ').trim();
      const ignoredNumber = ignoredTokens.join(' ').trim();

      if(name) return {kind:'open', name, ignoredNumber: ignoredNumber || null};
      return {kind:'unknown', raw: rawText};
    }

    let namePart = tokens.slice(0, action.index).join(' ').trim();
    let amountPart = tokens.slice(action.index+1).join(' ').trim();

    // الفعل قبل الاسم: "اطرح من محمد عشرة آلاف" أو "أضف عبد العزيز خمسين ألف"
    // أو "حط على علي خمسين ألف". لو الاسم فاضي، نجمع كل الكلمات بعد الفعل
    // مباشرة طالما مو أرقام ولا اسم عملة — يدعم هذا أسماء من عدة كلمات.
    //
    // ملاحظة مهمة: حرف الجر "على" يتطابق حرفياً مع الاسم "علي" بعد التطبيع
    // الداخلي (كلاهما يصبحان "علي")! فلو قال البائع "حط على علي" بيصير
    // "علي علي" بالغلط لو اعتبرناها دايماً جزء من الاسم. نتعامل معها بحذر:
    // نجرّب أولاً افتراض إنها حرف جر (مثل "من") ونحذفها؛ فقط لو أدى هذا
    // لضياع الاسم بالكامل (يعني ما بقي إلا أرقام)، نتراجع ونعتبرها الاسم نفسه.
    if(!namePart){
      const after = tokens.slice(action.index+1);
      const collectName = (arr)=>{
        let j = 0; const nameTokens = [];
        while(j < arr.length){
          const tj = arr[j];
          if(isNumberWordToken(tj) || CURRENCY_MAP[tj] !== undefined) break;
          nameTokens.push(tj);
          j++;
        }
        return {name: nameTokens.join(' ').trim(), rest: arr.slice(j)};
      };

      const PREPOSITIONS = ['من', 'علي']; // 'علي' هنا تمثل أيضاً "على" بعد التطبيع
      if(PREPOSITIONS.includes(after[0])){
        const withoutPrep = collectName(after.slice(1));
        if(withoutPrep.name){
          namePart = withoutPrep.name;
          amountPart = withoutPrep.rest.join(' ').trim();
        } else {
          // التراجع: حذف حرف الجر المفترض ترك الاسم فارغاً، يعني الأرجح إنها
          // كانت الاسم نفسه ("علي" كاسم) وليست حرف جر — نعيدها للاسم
          const withPrep = collectName(after);
          namePart = withPrep.name;
          amountPart = withPrep.rest.join(' ').trim();
        }
      } else {
        const r = collectName(after);
        if(r.name){
          namePart = r.name;
          amountPart = r.rest.join(' ').trim();
        }
      }
    }

    // عناصر متعددة مفصولة بفواصل: "سكر عشرين ألف , رز خمسة عشر ألف"
    let items = [];
    let totalAmount = 0;
    let currency = DEFAULT_CURRENCY;
    if(amountPart.includes(',')){
      currency = detectCurrency(amountPart); // عملة واحدة للعملية كاملة حتى لو تعددت الأصناف
      const segs = amountPart.split(',').map(s=>s.trim()).filter(Boolean);
      for(const seg of segs){
        const num = wordsToNumber(seg);
        if(num !== null){
          // استخراج اسم الصنف: أزل الكلمات الرقمية وأسماء العملات من القطعة
          let itemName = seg;
          Object.keys(ONES).concat(Object.keys(TENS),Object.keys(HUNDREDS),Object.keys(SCALE),Object.keys(SPECIAL),Object.keys(CURRENCY_MAP),[NISF])
            .forEach(w=>{ itemName = itemName.replace(new RegExp('\\b'+w+'\\b','g'),''); });
          itemName = itemName.replace(/\s+/g,' ').trim();
          items.push({name:itemName || 'صنف', amount:num});
          totalAmount += num;
        }
      }
    } else {
      // "مئة الف معدات صحية" أو "مئتين دولار": نستخرج المبلغ والعملة، وأي نص
      // متبقٍ بعدهما يُعتبر اسم السلعة/الصنف المرتبط بهذه العملية
      const r = parseAmountCurrencyItem(amountPart);
      totalAmount = r.amount;
      currency = r.currency || DEFAULT_CURRENCY;
      if(r.itemName) items.push({name: r.itemName, amount: totalAmount});
    }

    return {
      kind:'transaction',
      name: namePart,
      type: action.type,
      amount: totalAmount,
      currency,
      items,
      raw: rawText
    };
  }

  // يبحث عن "الكلمة المفتاحية" داخل نص التسجيل، ويُرجع فقط ما بعدها (الأمر الفعلي)،
  // أو null إن لم تُذكر إطلاقاً (يعني الكلام على الأغلب خلفية/ضجيج غير موجّه للتطبيق)
  // مثال: applyWakeWord("في الجو حر اليوم دفتر خالد إضافة خمسين ألف", "دفتر")
  //       => "خالد إضافة خمسين ألف" (تجاهل الجزء قبل الكلمة المفتاحية تلقائياً)
  function applyWakeWord(rawText, wakeWord){
    if(!wakeWord) return rawText; // لا كلمة مفتاحية مُفعّلة: مرّر النص كما هو
    const wake = normalizeArabic(wakeWord);
    if(!wake) return rawText;
    const normText = normalizeArabic(rawText);
    const idx = normText.indexOf(wake);
    if(idx === -1) return null;
    return normText.slice(idx + wake.length).trim();
  }

  // يبحث عن "الكلمة الختامية" (زي "خلص" أو "تم") داخل نص التسجيل — إن وُجدت
  // نقصّها مع أي كلام بعدها (قد يكون كلاماً جانبياً بدأ بعد ما خلص البائع
  // أمره فعلياً) ونُرجع النص السابق لها فقط كأمر جاهز للمعالجة فوراً، بدل
  // انتظار مهلة الصمت كاملة.
  // مثال: stripEndWord("محمد إضافة خمسين ألف خلص", "خلص") => {text:"محمد إضافة خمسين ألف", found:true}
  function stripEndWord(rawText, endWord){
    if(!endWord) return {text: rawText, found:false};
    const end = normalizeArabic(endWord);
    if(!end) return {text: rawText, found:false};
    const normText = normalizeArabic(rawText);
    const idx = normText.lastIndexOf(end);
    if(idx === -1) return {text: normText, found:false};
    return {text: normText.slice(0, idx).trim(), found:true};
  }

  return {
    normalizeArabic,
    wordsToNumber,
    parseCommand,
    parseMultipleCommands,
    applyWakeWord,
    stripEndWord,
    CURRENCY_SYMBOLS,
    DEFAULT_CURRENCY,
    // نصدّرها أيضاً لأغراض الاختبار المتقدم إن لزم لاحقاً
    _internal: { ONES, TEENS, TENS, HUNDREDS, SPECIAL, SCALE, CURRENCY_MAP }
  };
}));
