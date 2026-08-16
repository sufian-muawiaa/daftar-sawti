/* =========================================================
   دفتر الديون الصوتي — app.js
   يعمل بالكامل محلياً (localStorage) بدون إنترنت
   ========================================================= */
(function(){
"use strict";

/* ============ أدوات عامة ============ */
const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,7);
const fmt = n => Math.round(n).toLocaleString('en-US');
const now = () => new Date();
const fmtDate = d => new Date(d).toLocaleDateString('ar-SY', {year:'numeric', month:'2-digit', day:'2-digit'});
const fmtDateTime = d => new Date(d).toLocaleString('ar-SY', {year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit'});

function toast(msg, ms=2200){
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._h);
  toast._h = setTimeout(()=> t.hidden = true, ms);
}

// يمنع أي بيانات أدخلها المستخدم (اسم زبون، ملاحظة، صنف...) من كسر الصفحة
// أو تنفيذ أكواد HTML/JS عند عرضها لاحقاً عبر innerHTML
function esc(str){
  if(str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

/* ============ طبقة التخزين المحلي ============ */
const STORE_KEY = 'daftar_sawti_v1';

function defaultData(){
  return {
    customers: {},     // id -> {id,name,altNames[],father,nickname,phone,address,notes,openingBalance,createdAt,reminderDate,reminderNote}
    transactions: {},  // id -> {id,customerId,type:'add'|'subtract',amount,items[],note,voiceText,date,deleted}
    settings: { darkMode:false, themeSet:false, quickMode:true, continuous:false, shopName:'', pin:'', dialectLocale:'ar-SA', wakeWordEnabled:false, wakeWord:'دفتر', syncChannel:'' }
  };
}

let DB = load();

function load(){
  try{
    const raw = localStorage.getItem(STORE_KEY);
    if(!raw) return defaultData();
    const parsed = JSON.parse(raw);
    return Object.assign(defaultData(), parsed);
  }catch(e){
    console.error('load error', e);
    return defaultData();
  }
}

function save(){
  localStorage.setItem(STORE_KEY, JSON.stringify(DB));
}

/* ============ منطق الحسابات (متعدد العملات) ============ */
const DEFAULT_CURRENCY = (window.DaftarParser && window.DaftarParser.DEFAULT_CURRENCY) || 'SYP';
const CURRENCY_SYMBOLS = (window.DaftarParser && window.DaftarParser.CURRENCY_SYMBOLS) || {SYP:'ل.س'};

// يرجع رصيد الزبون ككائن لكل عملة على حدة، مثلاً {SYP: 65000, USD: 200}
// (كل عملة مستقلة تماماً عن الأخرى — لا نحوّل بينها لأننا لا نملك سعر صرف موثوق)
function customerBalanceMap(customerId){
  const c = DB.customers[customerId];
  const map = {};
  if(!c) return map;
  const opening = Number(c.openingBalance) || 0;
  if(opening !== 0) map[DEFAULT_CURRENCY] = (map[DEFAULT_CURRENCY]||0) + opening;
  const txs = Object.values(DB.transactions)
    .filter(t => t.customerId === customerId && !t.deleted)
    .sort((a,b)=> a.date - b.date);
  for(const t of txs){
    const cur = t.currency || DEFAULT_CURRENCY;
    map[cur] = (map[cur]||0) + ((t.type === 'add') ? t.amount : -t.amount);
  }
  return map;
}

// رصيد مبسّط برقم واحد بعملة الليرة (للاستخدام بالترتيب/التلوين حيث يصعب
// المقارنة بين عملات مختلطة بشكل طبيعي — تبسيط مقصود، العرض دائماً متعدد العملات)
function customerBalance(customerId){
  return customerBalanceMap(customerId)[DEFAULT_CURRENCY] || 0;
}

// ينسّق كائن رصيد متعدد العملات كنص عربي مقروء: "65,000 ل.س، 200 $"
function formatBalanceMap(map){
  const entries = Object.entries(map || {}).filter(([,val])=> val !== 0);
  if(entries.length === 0) return `0 ${CURRENCY_SYMBOLS[DEFAULT_CURRENCY]}`;
  return entries.map(([cur,val])=> `${fmt(val)} ${CURRENCY_SYMBOLS[cur]||cur}`).join('، ');
}

function customerTxs(customerId, includeDeleted=false){
  return Object.values(DB.transactions)
    .filter(t => t.customerId === customerId && (includeDeleted || !t.deleted))
    .sort((a,b)=> b.date - a.date);
}

// سجل حركات بالترتيب الزمني مع الرصيد التراكمي *بعملة كل عملية نفسها* بعد كل حركة
function runningBalances(customerId){
  const c = DB.customers[customerId];
  if(!c) return [];
  const runningMap = {};
  const opening = Number(c.openingBalance) || 0;
  if(opening !== 0) runningMap[DEFAULT_CURRENCY] = opening;
  const txs = customerTxs(customerId).slice().sort((a,b)=> a.date - b.date);
  const out = [];
  for(const t of txs){
    const cur = t.currency || DEFAULT_CURRENCY;
    const next = (runningMap[cur] || 0) + (t.type === 'add' ? t.amount : -t.amount);
    runningMap[cur] = next;
    out.push({tx:t, balance:next, currency:cur});
  }
  return out.reverse();
}

// إجمالي الديون المستحقة لكل عملة عبر كل الزبائن
function totalDebtMap(){
  const totals = {};
  Object.keys(DB.customers).forEach(id=>{
    const map = customerBalanceMap(id);
    Object.entries(map).forEach(([cur,val])=>{
      if(val > 0) totals[cur] = (totals[cur]||0) + val;
    });
  });
  return totals;
}

function totalDebt(){
  return totalDebtMap()[DEFAULT_CURRENCY] || 0;
}

/* ============ محرك الأرقام والأوامر الصوتية ============ */
// منطق التحليل بالكامل منقول إلى parser.js (وحدة مستقلة بلا اعتماد على DOM،
// مُحمَّلة قبل هذا الملف في index.html) حتى يمكن اختبارها آلياً عبر Node.js —
// راجع tests/parser.test.js لتشغيل الاختبارات.
const { normalizeArabic, wordsToNumber, parseCommand } = window.DaftarParser;

/* ============ مطابقة أسماء الزبائن ============ */
function findCustomersByName(name){
  if(!name) return [];
  const q = normalizeArabic(name);
  return Object.values(DB.customers).filter(c=>{
    const all = [c.name, ...(c.altNames||[])].map(normalizeArabic);
    return all.some(n => n === q || n.includes(q) || q.includes(n));
  });
}

/* ============ عرض الشاشات (Router بسيط) ============ */
function navigate(view, params={}){
  $$('.view').forEach(v=> v.hidden = true);
  const el = document.getElementById('view-'+view);
  if(el){ el.hidden = false; window.scrollTo(0,0); }
  App.currentView = view;
  App.currentParams = params;
  renderView(view, params);
}

function renderView(view, params){
  if(view === 'home') renderHome();
  if(view === 'customers') renderCustomers();
  if(view === 'customer') renderCustomerPage(params.id);
  if(view === 'stats') renderStats();
  if(view === 'trash') renderTrash();
  if(view === 'reminders') renderReminders();
  if(view === 'settings') renderSettingsForm();
  if(view === 'sync') renderSyncView();
}

/* ============ الشاشة الرئيسية ============ */
function renderHome(){
  $('#homeTotalDebt').textContent = formatBalanceMap(totalDebtMap());
  const recent = Object.values(DB.transactions)
    .filter(t=>!t.deleted)
    .sort((a,b)=> b.date - a.date)
    .slice(0,6);
  const wrap = $('#recentList');
  wrap.innerHTML = '';
  if(recent.length === 0){
    wrap.innerHTML = '<p class="empty-state">لا توجد عمليات بعد. اضغط الختم لتسجيل أول عملية.</p>';
  } else {
    recent.forEach(t=>{
      const c = DB.customers[t.customerId];
      const symbol = CURRENCY_SYMBOLS[t.currency || DEFAULT_CURRENCY] || (t.currency || DEFAULT_CURRENCY);
      const row = document.createElement('div');
      row.className = 'recent-item';
      row.innerHTML = `<span>${c ? esc(c.name) : '—'}</span>
        <b class="${t.type==='add'?'amt-add':'amt-sub'}">${t.type==='add'?'+':'−'}${fmt(t.amount)} ${symbol}</b>`;
      row.addEventListener('click', ()=> navigate('customer', {id:t.customerId}));
      wrap.appendChild(row);
    });
  }
  renderRemindersBadge();
}

function renderRemindersBadge(){
  const today = new Date().toISOString().slice(0,10);
  const due = Object.values(DB.customers).filter(c => c.reminderDate && c.reminderDate <= today);
  const badge = $('#alertBadge');
  if(due.length > 0){ badge.hidden = false; badge.textContent = due.length; }
  else badge.hidden = true;
}

/* ============ قائمة الزبائن ============ */
function renderCustomers(){
  const search = $('#customerSearch').value.trim();
  const sortBy = $('#sortSelect').value;
  let list = Object.values(DB.customers);

  if(search){
    const q = normalizeArabic(search);
    list = list.filter(c => normalizeArabic(c.name).includes(q) ||
      (c.altNames||[]).some(a => normalizeArabic(a).includes(q)));
  }

  list = list.map(c => ({c, bal: customerBalance(c.id), balMap: customerBalanceMap(c.id), last: lastTxDate(c.id)}));

  if(sortBy === 'name') list.sort((a,b)=> a.c.name.localeCompare(b.c.name,'ar'));
  if(sortBy === 'debtDesc') list.sort((a,b)=> b.bal - a.bal);
  if(sortBy === 'debtAsc') list.sort((a,b)=> a.bal - b.bal);
  if(sortBy === 'recent') list.sort((a,b)=> (b.last||0) - (a.last||0));

  const wrap = $('#customerList');
  wrap.innerHTML = '';
  $('#customersEmpty').hidden = list.length > 0;

  list.forEach(({c,bal,balMap,last})=>{
    const row = document.createElement('div');
    row.className = 'customer-row';
    const cls = bal > 0 ? 'pos' : (bal < 0 ? 'neg' : 'zero');
    row.innerHTML = `
      <div class="cav">${esc(c.name.trim()[0] || '؟')}</div>
      <div class="cinfo">
        <div class="cname">${esc(c.name)}</div>
        <div class="clast">${last ? 'آخر عملية: '+fmtDate(last) : 'لا عمليات بعد'}</div>
      </div>
      <div class="cbal ${cls}">${esc(formatBalanceMap(balMap))}</div>`;
    row.addEventListener('click', ()=> navigate('customer', {id:c.id}));
    wrap.appendChild(row);
  });
}

function lastTxDate(customerId){
  const txs = customerTxs(customerId);
  return txs.length ? txs[0].date : null;
}

$('#customerSearch').addEventListener('input', renderCustomers);
$('#sortSelect').addEventListener('change', renderCustomers);

/* ============ صفحة الزبون ============ */
function renderCustomerPage(id){
  const c = DB.customers[id];
  if(!c){ navigate('customers'); return; }
  App.activeCustomerId = id;

  $('#custAvatar').textContent = c.name.trim()[0] || '؟';
  $('#custName').textContent = c.name;
  const metaParts = [];
  if(c.phone) metaParts.push('📞 '+c.phone);
  if(c.address) metaParts.push('📍 '+c.address);
  $('#custMeta').textContent = metaParts.join('  •  ');

  const balMap = customerBalanceMap(id);
  const bal = balMap[DEFAULT_CURRENCY] || 0;
  $('#custBalance').textContent = fmt(bal);
  $('#balanceCard').style.background = bal < 0
    ? 'linear-gradient(135deg,#1F4433,#2F6E4E)'
    : 'linear-gradient(135deg, var(--ink), var(--ink-3))';

  const extraCurrencies = Object.entries(balMap).filter(([cur,val]) => cur !== DEFAULT_CURRENCY && val !== 0);
  const extraEl = $('#custBalanceExtra');
  if(extraCurrencies.length){
    extraEl.hidden = false;
    extraEl.innerHTML = extraCurrencies.map(([cur,val])=>
      `<span>${fmt(val)} ${esc(CURRENCY_SYMBOLS[cur]||cur)}</span>`).join('');
  } else {
    extraEl.hidden = true;
    extraEl.innerHTML = '';
  }

  const rows = runningBalances(id);
  const wrap = $('#txTable');
  wrap.innerHTML = '';
  $('#txEmpty').hidden = rows.length > 0;

  rows.forEach(({tx,balance,currency})=>{
    const row = document.createElement('div');
    row.className = 'tx-row';
    const sign = tx.type === 'add' ? '+' : '−';
    const cls = tx.type === 'add' ? 'amt-add' : 'amt-sub';
    const symbol = CURRENCY_SYMBOLS[currency] || currency;
    let itemsLine = '';
    if(tx.items && tx.items.length){
      itemsLine = `<div class="tx-note">${tx.items.map(i=>`${esc(i.name)}: ${fmt(i.amount)} ${symbol}`).join('، ')}</div>`;
    }
    row.innerHTML = `
      <div class="tx-top">
        <span class="tx-date">${fmtDateTime(tx.date)}</span>
        <b class="tx-amt ${cls}">${sign}${fmt(tx.amount)} ${symbol}</b>
      </div>
      <div class="tx-bal">الرصيد بعد العملية (${symbol}): ${fmt(balance)}</div>
      ${itemsLine}
      ${tx.note ? `<div class="tx-note">📝 ${esc(tx.note)}</div>` : ''}
      <div class="tx-actions">
        <button data-act="edit" data-id="${tx.id}">✏️ تعديل</button>
        <button data-act="del" data-id="${tx.id}">🗑️ حذف</button>
        ${tx.voiceText ? `<button data-act="voice" data-id="${tx.id}">🎙️ النص الأصلي</button>` : ''}
      </div>`;
    wrap.appendChild(row);
  });

  $$('button[data-act]', wrap).forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const act = btn.dataset.act, txId = btn.dataset.id;
      if(act === 'del') deleteTransaction(txId);
      if(act === 'edit') openEditTransaction(txId);
      if(act === 'voice') toast('🎙️ ' + DB.transactions[txId].voiceText);
    });
  });
}

function deleteTransaction(txId){
  if(!confirm('هل أنت متأكد من حذف العملية؟')) return;
  DB.transactions[txId].deleted = true;
  save();
  broadcastSync({type:'tx_upsert', payload: DB.transactions[txId]});
  renderCustomerPage(App.activeCustomerId);
  toast('تم نقل العملية إلى سجل المحذوفات');
}

function openEditTransaction(txId){
  const tx = DB.transactions[txId];
  const amountStr = prompt('عدّل المبلغ:', tx.amount);
  if(amountStr === null) return;
  const val = parseInt(amountStr.replace(/[^\d]/g,''),10);
  if(isNaN(val)) return toast('رقم غير صالح');
  tx.amount = val;
  save();
  broadcastSync({type:'tx_upsert', payload: tx});
  renderCustomerPage(App.activeCustomerId);
  toast('تم تعديل العملية');
}

/* أزرار صفحة الزبون */
$('#btnQuickAdd').addEventListener('click', ()=> manualTransaction('add'));
$('#btnQuickPay').addEventListener('click', ()=> manualTransaction('subtract'));
$('#btnCustVoice').addEventListener('click', ()=> openRecordModal({presetCustomerId: App.activeCustomerId}));

function manualTransaction(type){
  const label = type === 'add' ? 'مبلغ الإضافة' : 'مبلغ الدفعة';
  const str = prompt(label + ' (بالأرقام):');
  if(!str) return;
  const val = parseInt(str.replace(/[^\d]/g,''),10);
  if(isNaN(val) || val<=0) return toast('رقم غير صالح');
  addTransaction(App.activeCustomerId, type, val, {note:'إدخال يدوي'});
  renderCustomerPage(App.activeCustomerId);
  toast('تم الحفظ ✓');
}

$('#btnCustNote').addEventListener('click', ()=>{
  const note = prompt('اكتب الملاحظة (أو استخدم لوحة المفاتيح الصوتية في جهازك):');
  if(!note) return;
  const c = DB.customers[App.activeCustomerId];
  c.notes = ((c.notes||'') + '\n' + note).trim();
  save();
  broadcastSync({type:'customer_upsert', payload: c});
  toast('تم حفظ الملاحظة');
});

$('#btnCustPhoto').addEventListener('click', ()=> toast('إضافة الصور تحتاج تشغيل التطبيق كتطبيق مثبت (APK) للوصول للكاميرا.'));

$('#btnCustInvoice').addEventListener('click', ()=> printCustomerStatement(App.activeCustomerId, 'فاتورة'));
$('#btnCustPrint').addEventListener('click', ()=> printCustomerStatement(App.activeCustomerId, 'كشف حساب'));

$('#btnCustShare').addEventListener('click', ()=>{
  const c = DB.customers[App.activeCustomerId];
  const balMap = customerBalanceMap(c.id);
  const rows = runningBalances(c.id).slice(0,10).reverse();
  let text = `كشف حساب ${c.name}\n`;
  rows.forEach(({tx,balance,currency})=>{
    const symbol = CURRENCY_SYMBOLS[currency] || currency;
    text += `${tx.type==='add'?'إضافة':'دفعة'}: ${fmt(tx.amount)} ${symbol} — الرصيد: ${fmt(balance)} ${symbol}\n`;
  });
  text += `\nالمتبقي: ${formatBalanceMap(balMap)}`;
  if(navigator.share){
    navigator.share({title:'كشف حساب '+c.name, text}).catch(()=>{});
  } else {
    navigator.clipboard.writeText(text).then(()=> toast('تم نسخ كشف الحساب — الصقه في واتساب أو أي تطبيق'));
  }
});

$('#btnEditCustomer').addEventListener('click', ()=>{
  const c = DB.customers[App.activeCustomerId];
  const name = prompt('الاسم:', c.name);
  if(name) c.name = name.trim();
  const phone = prompt('رقم الهاتف:', c.phone||'');
  c.phone = phone||'';
  save();
  broadcastSync({type:'customer_upsert', payload: c});
  renderCustomerPage(c.id);
});

$('#btnDeleteCustomer').addEventListener('click', ()=>{
  const c = DB.customers[App.activeCustomerId];
  if(!c) return;
  const balMap = customerBalanceMap(c.id);
  const hasBalance = Object.values(balMap).some(v => v !== 0);
  const balWarning = hasBalance
    ? `\n\n⚠️ تنبيه: رصيد "${c.name}" الحالي هو ${formatBalanceMap(balMap)} — سيُحذف نهائياً مع كامل سجل عملياته ولن تقدر تسترجعه.`
    : '';
  const ok = confirm(`هل أنت متأكد من حذف صفحة "${c.name}" نهائياً من الدفتر؟${balWarning}`);
  if(!ok) return;
  deleteCustomerCompletely(c.id);
  toast('تم حذف صفحة ' + c.name + ' نهائياً');
  navigate('customers');
});

function deleteCustomerCompletely(customerId){
  delete DB.customers[customerId];
  Object.keys(DB.transactions).forEach(txId=>{
    if(DB.transactions[txId].customerId === customerId) delete DB.transactions[txId];
  });
  save();
  broadcastSync({type:'customer_hard_delete', payload:{id: customerId}});
}

function printCustomerStatement(customerId, title){
  const c = DB.customers[customerId];
  const shopName = DB.settings.shopName || 'دفتر الديون الصوتي';
  const rows = runningBalances(customerId).slice().reverse();
  const balMap = customerBalanceMap(customerId);
  let html = `<div style="font-family:sans-serif;direction:rtl">
    <h2>${esc(shopName)}</h2>
    <h3>${esc(title)} — ${esc(c.name)}</h3>
    <p>التاريخ: ${fmtDate(Date.now())} ${c.phone ? '| الهاتف: '+esc(c.phone) : ''}</p>
    <table style="width:100%;border-collapse:collapse" border="1" cellpadding="6">
      <tr><th>التاريخ</th><th>العملية</th><th>المبلغ</th><th>الرصيد</th></tr>`;
  rows.forEach(({tx,balance,currency})=>{
    const symbol = CURRENCY_SYMBOLS[currency] || currency;
    html += `<tr><td>${fmtDate(tx.date)}</td><td>${tx.type==='add'?'إضافة':'دفعة'}</td><td>${fmt(tx.amount)} ${symbol}</td><td>${fmt(balance)} ${symbol}</td></tr>`;
  });
  html += `</table><h3>الإجمالي المتبقي: ${esc(formatBalanceMap(balMap))}</h3></div>`;
  const area = $('#printArea');
  area.innerHTML = html;
  area.hidden = false;
  window.print();
  area.hidden = true;
}

/* ============ إضافة زبون ============ */
$('#formAddCustomer').addEventListener('submit', e=>{
  e.preventDefault();
  const name = $('#fName').value.trim();
  if(!name) return;
  const id = createCustomer({
    name,
    altNames: $('#fAltNames').value.split(/[,،]/).map(s=>s.trim()).filter(Boolean),
    father: $('#fFather').value.trim(),
    nickname: $('#fNickname').value.trim(),
    phone: $('#fPhone').value.trim(),
    address: $('#fAddress').value.trim(),
    notes: $('#fNotes').value.trim(),
    openingBalance: parseInt(($('#fOpening').value||'0').replace(/[^\d]/g,''),10) || 0
  });
  e.target.reset();
  toast('تم إنشاء صفحة ' + name);
  navigate('customer', {id});
});

function createCustomer(data){
  const id = uid();
  DB.customers[id] = Object.assign({
    id, createdAt: Date.now(), altNames:[], reminderDate:null, reminderNote:''
  }, data);
  save();
  broadcastSync({type:'customer_upsert', payload: DB.customers[id]});
  return id;
}

function addTransaction(customerId, type, amount, extra={}){
  const id = uid();
  DB.transactions[id] = Object.assign({
    id, customerId, type, amount, currency: DEFAULT_CURRENCY, date: Date.now(), deleted:false, items:[]
  }, extra);
  save();
  broadcastSync({type:'tx_upsert', payload: DB.transactions[id]});
  return id;
}

/* ============ الإحصائيات ============ */
function sumByCurrency(list){
  const out = {};
  list.forEach(t=>{
    const cur = t.currency || DEFAULT_CURRENCY;
    out[cur] = (out[cur]||0) + t.amount;
  });
  return out;
}

function renderStats(){
  const custs = Object.values(DB.customers);
  const allTx = Object.values(DB.transactions).filter(t=>!t.deleted);
  const todayStr = new Date().toDateString();
  const monthKey = new Date().toISOString().slice(0,7);

  const totalDMap = totalDebtMap();
  const totalPaidMap = sumByCurrency(allTx.filter(t=>t.type==='subtract'));
  const debtTodayMap = sumByCurrency(allTx.filter(t=>t.type==='add' && new Date(t.date).toDateString()===todayStr));
  const paidTodayMap = sumByCurrency(allTx.filter(t=>t.type==='subtract' && new Date(t.date).toDateString()===todayStr));
  const debtMonthMap = sumByCurrency(allTx.filter(t=>t.type==='add' && new Date(t.date).toISOString().slice(0,7)===monthKey));
  const paidMonthMap = sumByCurrency(allTx.filter(t=>t.type==='subtract' && new Date(t.date).toISOString().slice(0,7)===monthKey));

  const stats = [
    ['إجمالي الديون', formatBalanceMap(totalDMap)],
    ['إجمالي المدفوع (كل الوقت)', formatBalanceMap(totalPaidMap)],
    ['عدد الزبائن', fmt(custs.length)],
    ['ديون اليوم', formatBalanceMap(debtTodayMap)],
    ['دفعات اليوم', formatBalanceMap(paidTodayMap)],
    ['ديون هذا الشهر', formatBalanceMap(debtMonthMap)],
    ['دفعات هذا الشهر', formatBalanceMap(paidMonthMap)],
  ];
  const grid = $('#statGrid');
  grid.innerHTML = stats.map(([l,v])=>`
    <div class="stat-card"><span class="sc-label">${esc(l)}</span><span class="sc-value">${esc(v)}</span></div>`).join('');

  const top = custs.map(c=>({c, bal:customerBalance(c.id), balMap:customerBalanceMap(c.id)}))
    .sort((a,b)=> b.bal - a.bal).slice(0,10);
  const wrap = $('#topDebtsList');
  wrap.innerHTML = '';
  top.forEach(({c,balMap})=>{
    const row = document.createElement('div');
    row.className = 'customer-row';
    row.innerHTML = `<div class="cav">${esc(c.name.trim()[0]||'؟')}</div>
      <div class="cinfo"><div class="cname">${esc(c.name)}</div></div>
      <div class="cbal pos">${esc(formatBalanceMap(balMap))}</div>`;
    row.addEventListener('click', ()=> navigate('customer', {id:c.id}));
    wrap.appendChild(row);
  });
}

/* ============ سجل المحذوفات ============ */
function renderTrash(){
  const deleted = Object.values(DB.transactions).filter(t=>t.deleted).sort((a,b)=>b.date-a.date);
  const wrap = $('#trashList');
  wrap.innerHTML = '';
  $('#trashEmpty').hidden = deleted.length > 0;
  deleted.forEach(tx=>{
    const c = DB.customers[tx.customerId];
    const row = document.createElement('div');
    row.className = 'tx-row';
    row.innerHTML = `<div class="tx-top"><span>${c?esc(c.name):'—'}</span>
      <b class="${tx.type==='add'?'amt-add':'amt-sub'}">${tx.type==='add'?'+':'−'}${fmt(tx.amount)}</b></div>
      <div class="tx-bal">${fmtDateTime(tx.date)}</div>
      <div class="tx-actions"><button data-restore="${tx.id}">↩️ استعادة</button></div>`;
    wrap.appendChild(row);
  });
  $$('button[data-restore]', wrap).forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const tx = DB.transactions[btn.dataset.restore];
      tx.deleted = false;
      save();
      broadcastSync({type:'tx_upsert', payload: tx});
      renderTrash();
      toast('تم استعادة العملية');
    });
  });
}

/* ============ التذكيرات ============ */
function renderReminders(){
  const withReminders = Object.values(DB.customers).filter(c=>c.reminderDate).sort((a,b)=> a.reminderDate.localeCompare(b.reminderDate));
  const wrap = $('#remindersList');
  wrap.innerHTML = '';
  $('#remindersEmpty').hidden = withReminders.length > 0;
  const today = new Date().toISOString().slice(0,10);
  withReminders.forEach(c=>{
    const row = document.createElement('div');
    row.className = 'tx-row';
    const due = c.reminderDate <= today;
    row.innerHTML = `<div class="tx-top"><span>${due?'🔔 ':''}${esc(c.name)}</span><b>${esc(c.reminderDate)}</b></div>
      ${c.reminderNote?`<div class="tx-note">${esc(c.reminderNote)}</div>`:''}
      <div class="tx-actions"><button data-open="${c.id}">فتح الصفحة</button><button data-clear="${c.id}">إزالة التذكير</button></div>`;
    wrap.appendChild(row);
  });
  $$('button[data-open]', wrap).forEach(b=> b.addEventListener('click', ()=> navigate('customer',{id:b.dataset.open})));
  $$('button[data-clear]', wrap).forEach(b=> b.addEventListener('click', ()=>{
    const c = DB.customers[b.dataset.clear];
    c.reminderDate = null;
    save();
    broadcastSync({type:'customer_upsert', payload: c});
    renderReminders();
  }));
}

/* ============ الإعدادات ============ */
function renderSettingsForm(){
  $('#setDark').checked = !!DB.settings.darkMode;
  $('#setQuick').checked = !!DB.settings.quickMode;
  $('#setContinuous').checked = !!DB.settings.continuous;
  $('#setDialect').value = DB.settings.dialectLocale || 'ar-SA';
  $('#setWakeWordEnabled').checked = !!DB.settings.wakeWordEnabled;
  $('#setWakeWord').value = DB.settings.wakeWord || '';
  $('#setShopName').value = DB.settings.shopName || '';
  $('#setPin').value = '';
  updatePinStatus();
}

// يعرض بوضوح هل القفل مفعّل فعلياً الآن أو لا — الخانة نفسها تُترك فاضية دائماً
// (لإخفاء الرقم السري)، فلا يكفي النظر لها وحدها لمعرفة الحالة الحقيقية
function updatePinStatus(){
  const active = !!DB.settings.pin;
  const row = $('#pinStatusRow');
  const text = $('#pinStatusText');
  const btn = $('#btnRemovePin');
  row.classList.toggle('active', active);
  text.textContent = active ? '🔒 القفل مفعّل حالياً' : 'غير مفعّل حالياً';
  btn.hidden = !active;
}
$('#setDark').addEventListener('change', e=>{
  DB.settings.darkMode = e.target.checked;
  DB.settings.themeSet = true;
  document.body.classList.toggle('dark', DB.settings.darkMode);
  applyTheme();
  save();
});
$('#setQuick').addEventListener('change', e=>{ DB.settings.quickMode = e.target.checked; save(); });
$('#setContinuous').addEventListener('change', e=>{ DB.settings.continuous = e.target.checked; save(); });
$('#setDialect').addEventListener('change', e=>{
  DB.settings.dialectLocale = e.target.value;
  save();
  toast('سيتم تطبيق اللهجة الجديدة بالتسجيل التالي');
});
$('#setWakeWordEnabled').addEventListener('change', e=>{
  DB.settings.wakeWordEnabled = e.target.checked;
  save();
});
$('#setWakeWord').addEventListener('input', e=>{
  DB.settings.wakeWord = e.target.value.trim();
  save();
});
$('#setShopName').addEventListener('input', e=>{ DB.settings.shopName = e.target.value; save(); });

// نستخدم حدث "input" (يطلق مع كل ضغطة زر) بدل "change" (يطلق فقط عند فقد
// التركيز إن اختلفت القيمة عن بدايتها) — لأن الخانة تُعرض فاضية دائماً حتى
// لو فيه قفل مفعّل، فلو المستخدم كتب رقماً ثم مسحه بالكامل راجعاً للفراغ،
// "change" ما كان يطلق أبداً (القيمة النهائية = القيمة الابتدائية)، فيبقى
// القفل القديم مفعّلاً بصمت رغم إنه يبدو أنه أُلغي. "input" يحل هذا تماماً.
$('#setPin').addEventListener('input', e=>{
  DB.settings.pin = e.target.value.trim();
  save();
  updatePinStatus();
});
// زر إزالة صريح وموثوق 100% بغض النظر عن حالة الخانة — أوضح للمستخدم من
// مجرد "امسح الخانة" اللي سبّبت اللبس أصلاً
$('#btnRemovePin').addEventListener('click', ()=>{
  DB.settings.pin = '';
  save();
  $('#setPin').value = '';
  updatePinStatus();
  toast('✓ تم إلغاء القفل نهائياً');
});

/* ============ النسخ الاحتياطي ============ */
$('#btnExportBackup').addEventListener('click', ()=>{
  const blob = new Blob([JSON.stringify(DB, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'نسخة-احتياطية-دفتر-الديون-' + new Date().toISOString().slice(0,10) + '.json';
  a.click();
  URL.revokeObjectURL(url);
  toast('تم تنزيل النسخة الاحتياطية');
});

$('#importBackupFile').addEventListener('change', e=>{
  const file = e.target.files[0];
  if(!file) return;
  if(!confirm('سيتم استبدال كل البيانات الحالية بالنسخة المستوردة. متابعة؟')) return;
  const reader = new FileReader();
  reader.onload = ()=>{
    try{
      const parsed = JSON.parse(reader.result);
      DB = Object.assign(defaultData(), parsed);
      save();
      sendFullSync(); // ادفع البيانات المستعادة فوراً للجهاز المتصل إن وُجد
      toast('تم استعادة النسخة الاحتياطية بنجاح');
      navigate('home');
    }catch(err){
      toast('ملف غير صالح');
    }
  };
  reader.readAsText(file);
});

/* ============ التنقل العام ============ */
$$('[data-nav]').forEach(el=>{
  el.addEventListener('click', ()=> navigate(el.dataset.nav));
});

/* ============ نافذة التسجيل الصوتي ============ */
const App = { currentView:'home', activeCustomerId:null, currentParams:{} };
let recognition = null;
let recognitionSupported = false;
let currentParsed = null;
let pendingAmbiguous = null;
let listenWatchdog = null;
let silenceDebounce = null;      // مؤقت "انتهى الكلام" بعد فترة صمت كافية
let recognitionActiveText = '';  // آخر نص متراكم أثناء الجلسة الحالية
let recognitionProcessed = false; // لمنع معالجة نفس النص مرتين
let recognitionRunning = false;   // هل جلسة التعرف الصوتي شغّالة فعلياً الآن؟
let pendingRestart = false;       // طلب إعادة استماع مؤجّل حتى تنتهي الجلسة الحالية فعلياً

// المدة الزمنية (بالمللي ثانية) اللي لازم تمر فيها صمت بعد آخر كلمة قبل ما نعتبر
// إن البائع خلّص كلامه. رقم أكبر = مهلة أطول ومجال أوسع للتوقف الطبيعي بين الكلمات
// دون قطع التسجيل، لكن استجابة أبطأ شوي بعد انتهاء الكلام الفعلي.
const SILENCE_MS = 1800;

// التعرف الصوتي في المتصفح يعمل فقط ضمن "سياق آمن": HTTPS أو http://localhost.
// فتح الملف مباشرة (file:///...) أو رابط http عادي على شبكة محلية يمنعه المتصفح بصمت.
function isSecureContextForVoice(){
  if(location.protocol === 'https:') return true;
  if(location.hostname === 'localhost' || location.hostname === '127.0.0.1') return true;
  return false;
}

// متصفحات الموبايل (خصوصاً أندرويد) تتعامل مع خاصية التعرف الصوتي المستمر
// (continuous) بشكل غير مستقر مقارنة بكروم على الحاسوب — أحياناً لا تعمل
// إطلاقاً، أو تُطلق خطأ "no-speech" بسرعة كبيرة. لهذا نعطّل الاستماع المستمر
// على الموبايل تحديداً ونعتمد بدلاً منه على إعادة تشغيل الجلسة تلقائياً بعد
// كل توقف قصير (نفس الفكرة، بس بجلسات متتالية قصيرة بدل جلسة واحدة طويلة)
const isMobileDevice = /Android|iPhone|iPad|iPod|Mobile|Opera Mini/i.test(navigator.userAgent);

function setupSpeechRecognition(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SR || !isSecureContextForVoice()){ recognitionSupported = false; return; }
  recognitionSupported = true;
  recognition = new SR();
  recognition.lang = 'ar-SA';
  recognition.interimResults = true;
  recognition.continuous = !isMobileDevice;
  recognition.maxAlternatives = 1;

  recognition.onstart = ()=>{
    recognitionRunning = true;
  };
  recognition.onresult = (ev)=>{
    clearListenWatchdog();
    let text = '';
    for(let i=0; i<ev.results.length; i++) text += ev.results[i][0].transcript;
    recognitionActiveText = text;
    $('#heardText').textContent = '«' + text + '»';
    // كل ما وصل كلام جديد (حتى لو غير نهائي بعد) نعيد ضبط مؤقت الصمت من الصفر —
    // لا نعالج النص إلا بعد فترة SILENCE_MS من الهدوء الفعلي، فيصير للبائع وقت
    // كافٍ يكمل جملته دون ما يُقطع تسجيله عند أول وقفة قصيرة
    if(silenceDebounce) clearTimeout(silenceDebounce);
    silenceDebounce = setTimeout(finalizeRecognitionIfAny, SILENCE_MS);
  };
  recognition.onerror = (ev)=>{
    clearListenWatchdog();
    clearSilenceDebounce();
    stopListeningVisual();
    if(ev.error === 'not-allowed' || ev.error === 'service-not-allowed'){
      $('#recordStateLabel').textContent = '⚠️ لم يُسمح باستخدام الميكروفون';
      toast('يرجى السماح باستخدام الميكروفون من إعدادات المتصفح');
      showTypeFallback();
    } else if(ev.error === 'no-speech'){
      // شائع جداً على الموبايل: مهلة الصمت الداخلية للمتصفح أقصر بكثير من
      // الحاسوب، فيُطلق هذا الخطأ بسرعة حتى لو المستخدم لسا ما بدأ الكلام
      // (مثلاً وهو بانتظار قول الكلمة المفتاحية). طالما النافذة لسا مفتوحة
      // نعيد المحاولة تلقائياً بصمت بدل التوقف والتحول لخانة الكتابة —
      // وإلا كانت الكلمة المفتاحية تبدو "ما تستجيب إطلاقاً" على الموبايل
      if(!$('#recordModal').hidden){
        recognitionActiveText = '';
        recognitionProcessed = false;
        setTimeout(()=>{ if(!$('#recordModal').hidden) startListeningSession(); }, 300);
      } else {
        showTypeFallback();
      }
    } else if(ev.error === 'aborted'){
      // إيقاف متعمّد من كودنا (مثلاً عند إعادة التشغيل)، ليس خطأ فعلياً — تجاهله بصمت
    } else {
      $('#recordStateLabel').textContent = '⚠️ تعذر التعرف على الصوت';
      $('#heardText').textContent = 'حدث خطأ في التعرف الصوتي (' + ev.error + '). جرّب الكتابة بدلاً منه:';
      showTypeFallback();
    }
  };
  recognition.onend = ()=>{
    recognitionRunning = false;
    clearListenWatchdog();
    stopListeningVisual();
    // شبكة أمان: لو انتهت الجلسة (مثلاً المتصفح أوقفها من نفسه) قبل ما يطلق
    // مؤقت الصمت الخاص فينا، نعالج آخر نص وصلنا إن وُجد بدل ما يضيع الكلام بصمت
    finalizeRecognitionIfAny();
    // لو كان فيه طلب معلَّق لإعادة الاستماع (بعد حفظ عملية)، ننفّذه الآن بعد
    // ما تأكدنا فعلياً إن الجلسة القديمة انتهت بالكامل — هذا يمنع خطأ التسابق
    // "recognition has already started" اللي كان يوقف الاستماع التلقائي بصمت
    if(pendingRestart){
      pendingRestart = false;
      startListeningSession();
    }
  };
}
setupSpeechRecognition();

// نقطة البدء الموحّدة والآمنة للاستماع: تُستخدم من كل مكان بدل استدعاء
// recognition.start() مباشرة، لتفادي أخطاء التسابق عند بدء جلسة قبل انتهاء سابقتها فعلياً
let micPrimed = false;
// نطلب مرة واحدة بداية استخدام الميكروفون بخصائص تقليل الضجيج/الصدى المدمجة
// بالمتصفح (echoCancellation, noiseSuppression, autoGainControl). هذا تحسين
// "قدر الإمكان" فعلي ومتاح تقنياً — لكن بصراحة: متصفح الويب لا يمنحنا وصولاً
// لبناء فلتر ذكاء اصطناعي حقيقي يفصل الصوت القريب عن الضجيج البعيد؛ هذي
// الخصائص تعتمد على دعم المتصفح والجهاز نفسه وليست مضمونة النتيجة دائماً.
async function primeMicrophoneOnce(){
  if(micPrimed || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
  micPrimed = true;
  try{
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation:true, noiseSuppression:true, autoGainControl:true }
    });
    stream.getTracks().forEach(t=> t.stop()); // كنا فقط نطلب الخصائص، ما نحتاج نبقي القناة مفتوحة
  }catch(e){ /* تجاهل بصمت: لو رُفضت الصلاحية هنا، محرك التعرف الصوتي نفسه سيطلبها لاحقاً */ }
}

function startListeningSession(){
  if(!recognitionSupported || !isSecureContextForVoice()){ showTypeFallback(); return; }
  if(recognitionRunning){
    // جلسة سابقة لسا شغّالة فعلياً: نطلب إيقافها ثم الانتظار لحدث onend لبدء جلسة جديدة هناك
    pendingRestart = true;
    try{ recognition.stop(); }catch(e){}
    return;
  }
  primeMicrophoneOnce();
  recognition.lang = DB.settings.dialectLocale || 'ar-SA';
  try{
    recognition.start();
    $('#btnRecord').classList.add('listening');
    $('#recordStateLabel').textContent = '🔴 جاري الاستماع...';
    clearListenWatchdog();
    listenWatchdog = setTimeout(()=>{
      try{ recognition.stop(); }catch(e){}
      stopListeningVisual();
      $('#recordStateLabel').textContent = '⏱️ لم يصل رد من الميكروفون';
      $('#heardText').textContent = 'لم يستجب التعرف الصوتي. تأكد من السماح للميكروفون، أو استخدم الكتابة، أو أغلق النافذة إن انتهيت.';
      showTypeFallback();
    }, 12000);
  }catch(e){
    showTypeFallback();
  }
}

function clearListenWatchdog(){
  if(listenWatchdog){ clearTimeout(listenWatchdog); listenWatchdog = null; }
}

function clearSilenceDebounce(){
  if(silenceDebounce){ clearTimeout(silenceDebounce); silenceDebounce = null; }
}

// يعالج آخر نص متراكم بعد التأكد من انتهاء الكلام فعلياً (فترة صمت كافية أو انتهاء الجلسة)
function finalizeRecognitionIfAny(){
  clearSilenceDebounce();
  if(recognitionProcessed) return;
  const text = (recognitionActiveText || '').trim();
  if(!text) return;
  recognitionProcessed = true;
  try{ recognition.stop(); }catch(e){}

  // فلترة الكلمة المفتاحية: أي كلام لا يحتوي عليها (دردشة جانبية، ضجيج...)
  // يُتجاهل بصمت تماماً بدل ما يُسجَّل بالغلط كأمر مالي
  const wake = DB.settings.wakeWordEnabled ? (DB.settings.wakeWord || '').trim() : '';
  const filtered = window.DaftarParser.applyWakeWord(text, wake);

  if(filtered === null){
    // الكلمة المفتاحية غير موجودة إطلاقاً: كلام خلفية على الأغلب — نتجاهله
    // بهدوء ونعيد الاستماع فوراً دون أي إشعار مزعج يقاطع البائع
    recognitionActiveText = '';
    recognitionProcessed = false;
    $('#heardText').textContent = `بانتظار الكلمة المفتاحية «${wake}»...`;
    startListeningSession();
    return;
  }
  if(!filtered){
    // قال الكلمة المفتاحية لوحدها بدون أمر بعدها بعد — نعطيه فرصة يكمل
    recognitionActiveText = '';
    recognitionProcessed = false;
    $('#heardText').textContent = 'سمعتك! قل اسم الزبون والعملية والمبلغ الآن...';
    startListeningSession();
    return;
  }

  handleRecognizedText(filtered);
}

function openRecordModal(opts={}){
  currentParsed = null;
  pendingAmbiguous = null;
  recognitionActiveText = '';
  recognitionProcessed = false;
  pendingRestart = false;
  clearSilenceDebounce();
  App.recordOpts = opts;
  App.lastFocusedBeforeModal = document.activeElement;
  $('#recordModal').hidden = false;
  $('#recordModal').style.display = 'flex';
  $('#recordStateLabel').textContent = '🔴 جاري الاستماع...';
  $('#heardText').textContent = (DB.settings.wakeWordEnabled && DB.settings.wakeWord)
    ? `قل «${DB.settings.wakeWord}» أولاً ثم أمرك، مثل: «${DB.settings.wakeWord} محمد إضافة خمسين ألف»`
    : 'قل شيئاً مثل: «محمد إضافة خمسين ألف»';
  $('#parseResult').hidden = true;
  $('#ambiguousBox').hidden = true;
  $('#notFoundBox').hidden = true;
  $('#quickModeLog').hidden = false;
  $('#quickModeLog').innerHTML = '';
  $('#typeFallback').hidden = true;
  $('#btnCloseModal').focus();

  if(!isSecureContextForVoice()){
    $('#recordStateLabel').textContent = '⌨️ اكتب الأمر';
    $('#heardText').textContent = 'التعرف الصوتي يحتاج فتح الصفحة عبر رابط https (مثل رابط Netlify)، وليس بفتح الملف مباشرة من جهازك. اكتب الأمر بدلاً منه مؤقتاً:';
    $('#typeFallback').hidden = false;
    $('#typeInput').focus();
    return;
  }

  startListeningSession();
}

function showTypeFallback(){
  $('#typeFallback').hidden = false;
  $('#typeInput').focus();
}

function stopListeningVisual(){
  $('#btnRecord').classList.remove('listening');
}

function closeRecordModal(){
  clearListenWatchdog();
  clearSilenceDebounce();
  recognitionProcessed = true; // يمنع أي معالجة متأخرة بعد الإغلاق
  pendingRestart = false; // يمنع إعادة فتح الاستماع تلقائياً بعد إغلاق صريح من المستخدم
  // إغلاق مضمون دائماً حتى لو كان هناك خطأ في كائن التعرف الصوتي
  try{ if(recognition) recognition.abort ? recognition.abort() : recognition.stop(); }catch(e){}
  stopListeningVisual();
  const modal = $('#recordModal');
  modal.hidden = true;
  modal.style.display = 'none';
  if(App.lastFocusedBeforeModal && App.lastFocusedBeforeModal.focus){
    App.lastFocusedBeforeModal.focus();
  }
}

// مصيدة تركيز بسيطة: أثناء فتح النافذة، مفتاح Tab يبقى محصوراً داخلها
document.addEventListener('keydown', (e)=>{
  if(e.key !== 'Tab') return;
  const modal = $('#recordModal');
  if(modal.hidden) return;
  const focusables = $$('button, input, select, [tabindex]:not([tabindex="-1"])', modal)
    .filter(el => !el.disabled && el.offsetParent !== null);
  if(focusables.length === 0) return;
  const first = focusables[0], last = focusables[focusables.length-1];
  if(e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
  else if(!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
});

$('#btnRecord').addEventListener('click', ()=> openRecordModal());
$('#btnTypeInstead').addEventListener('click', ()=>{
  openRecordModal();
  showTypeFallback();
  if(recognitionSupported){ try{ recognition.stop(); }catch(e){} }
});
$('#btnCloseModal').addEventListener('click', closeRecordModal);
// إغلاق إضافي بالنقر على الخلفية المعتمة خارج البطاقة، وبمفتاح Escape — شبكة أمان مضاعفة
$('#recordModal').addEventListener('click', (e)=>{ if(e.target.id === 'recordModal') closeRecordModal(); });
document.addEventListener('keydown', (e)=>{ if(e.key === 'Escape' && !$('#recordModal').hidden) closeRecordModal(); });
$('#btnParseTyped').addEventListener('click', ()=>{
  const val = $('#typeInput').value.trim();
  if(val) handleRecognizedText(val);
});
$('#typeInput').addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); $('#btnParseTyped').click(); } });

function handleRecognizedText(text){
  clearListenWatchdog();

  // جملة واحدة قد تحتوي عدة أوامر متتالية (بدون فاصل صمت كافٍ بينها بصوت البائع)
  // مثل: "خالد إضافة خمسة آلاف عمر إضافة عشرة آلاف" — نفصلها ونسجّل كل واحدة لصاحبها
  const multi = (window.DaftarParser && window.DaftarParser.parseMultipleCommands)
    ? window.DaftarParser.parseMultipleCommands(text) : null;
  if(multi && multi.length >= 2){
    processMultipleCommands(multi, text);
    return;
  }

  const parsed = parseCommand(text);
  currentParsed = parsed;

  if(parsed.kind === 'query'){
    const matches = findCustomersByName(parsed.name);
    if(matches.length === 1){
      const bal = customerBalance(matches[0].id);
      $('#heardText').textContent = `دين ${matches[0].name}: ${fmt(bal)} ل.س`;
      speak(`دين ${matches[0].name} ${fmt(bal)} ليرة`);
    } else {
      $('#heardText').textContent = 'لم أفهم اسم الزبون بوضوح.';
    }
    return;
  }

  if(parsed.kind === 'open'){
    const matches = findCustomersByName(parsed.name);
    if(matches.length === 1){ closeRecordModal(); navigate('customer', {id:matches[0].id}); return; }
    if(matches.length > 1){ showAmbiguous(matches, ()=>{}); return; }
    // زبون جديد تمامًا: أنشئ له صفحة تلقائيًا دون سؤال
    const newId = createCustomer({name: (parsed.name||'').trim() || 'زبون جديد'});
    toast('✓ تم إنشاء صفحة جديدة: ' + DB.customers[newId].name);
    closeRecordModal();
    navigate('customer', {id:newId});
    return;
  }

  if(parsed.kind === 'unknown'){
    $('#heardText').textContent = 'لم أفهم الأمر. جرّب مثل: «محمد إضافة خمسين ألف»';
    return;
  }

  // kind === transaction
  const targetName = App.recordOpts && App.recordOpts.presetCustomerId ? null : parsed.name;
  let customer = null;
  if(App.recordOpts && App.recordOpts.presetCustomerId){
    customer = DB.customers[App.recordOpts.presetCustomerId];
  } else {
    const matches = findCustomersByName(parsed.name);
    if(matches.length === 1) customer = matches[0];
    else if(matches.length > 1){
      showAmbiguous(matches, (chosen)=> showParseResult(parsed, chosen));
      return;
    } else {
      // زبون جديد تمامًا: أنشئ له صفحة تلقائيًا دون سؤال، ثم كمّل تسجيل العملية عليه فورًا
      const newId = createCustomer({name: (parsed.name||'').trim() || 'زبون جديد'});
      customer = DB.customers[newId];
    }
  }
  showParseResult(parsed, customer);
}

function speak(text){
  if(!window.speechSynthesis) return;
  try{
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ar-SA';
    speechSynthesis.speak(u);
  }catch(e){}
}

function showAmbiguous(matches, onChoose){
  $('#ambiguousBox').hidden = false;
  $('#parseResult').hidden = true;
  $('#notFoundBox').hidden = true;
  const wrap = $('#ambiguousList');
  wrap.innerHTML = '';
  matches.forEach(c=>{
    const b = document.createElement('button');
    b.textContent = c.name + (c.phone ? ' — '+c.phone : '');
    b.addEventListener('click', ()=>{
      $('#ambiguousBox').hidden = true;
      onChoose(c);
    });
    wrap.appendChild(b);
  });
}

let pendingNewCustomerParsed = null; // محفوظة لأغراض توافقية، لم تعد تُستخدم فعلياً

let activeParseCtx = null;
function showParseResult(parsed, customer){
  activeParseCtx = {parsed, customer};
  const currency = parsed.currency || DEFAULT_CURRENCY;
  const symbol = CURRENCY_SYMBOLS[currency] || currency;
  const prevBal = customerBalanceMap(customer.id)[currency] || 0;
  const newBal = parsed.type === 'add' ? prevBal + parsed.amount : prevBal - parsed.amount;

  $('#parseResult').hidden = false;
  $('#prName').textContent = customer.name;
  $('#prAction').textContent = parsed.type === 'add' ? 'إضافة دين' : 'طرح / دفعة';
  $('#prAmount').textContent = fmt(parsed.amount) + ' ' + symbol;
  if(parsed.items && parsed.items.length){
    $('#prItemsRow').hidden = false;
    $('#prItems').textContent = parsed.items.map(i=>`${i.name} (${fmt(i.amount)} ${symbol})`).join('، ');
  } else {
    $('#prItemsRow').hidden = true;
  }
  $('#prPrev').textContent = fmt(prevBal) + ' ' + symbol;
  $('#prNew').textContent = fmt(newBal) + ' ' + symbol;
  $('#prEditWrap').hidden = true;

  if(DB.settings.quickMode){
    confirmParsedTransaction();
  }
}

$('#btnConfirmParsed').addEventListener('click', confirmParsedTransaction);
$('#btnCancelParsed').addEventListener('click', closeRecordModal);

$('#btnEditParsed').addEventListener('click', ()=>{
  const wrap = $('#prEditWrap');
  wrap.hidden = !wrap.hidden;
  if(!wrap.hidden){
    const sel = $('#editName');
    sel.innerHTML = Object.values(DB.customers).map(c=>`<option value="${c.id}" ${c.id===activeParseCtx.customer.id?'selected':''}>${esc(c.name)}</option>`).join('');
    $('#editAction').value = activeParseCtx.parsed.type;
    $('#editAmount').value = activeParseCtx.parsed.amount;
  }
});

// يسجّل عدة أوامر منفصلة وردت بجملة واحدة، كل واحدة لصاحبها، بلا مقاطعة
// (باستثناء الأسماء المتشابهة: نأخذ أول تطابق تلقائياً تفادياً لمقاطعة الدفعة
// بقائمة اختيار في منتصف تسجيل عدة عمليات؛ الاسم غير الموجود يُنشأ تلقائياً)
function processMultipleCommands(commands, rawText){
  $('#ambiguousBox').hidden = true;
  $('#notFoundBox').hidden = true;
  $('#parseResult').hidden = true;

  const summary = [];
  commands.forEach(cmd=>{
    const matches = findCustomersByName(cmd.name);
    let customer;
    if(matches.length >= 1){
      customer = matches[0];
    } else {
      const newId = createCustomer({name: cmd.name || 'زبون جديد'});
      customer = DB.customers[newId];
    }
    // ملاحظة: الأوامر المتعددة بجملة واحدة تُسجَّل حالياً بالعملة الافتراضية
    // (ليرة سورية) فقط؛ دعم عملة مختلفة لكل أمر ضمن نفس الجملة غير مطبّق بعد
    addTransaction(customer.id, cmd.type, cmd.amount, {currency: DEFAULT_CURRENCY, voiceText: rawText, items: []});
    const newBal = customerBalance(customer.id);
    const sign = cmd.type === 'add' ? '+' : '−';
    const symbol = CURRENCY_SYMBOLS[DEFAULT_CURRENCY];
    logQuick(customer.name, cmd.type, cmd.amount, symbol);
    summary.push(`${customer.name} ${sign}${fmt(cmd.amount)} ${symbol}`);
  });

  toast(`✓ تم تسجيل ${commands.length} عمليات: ` + summary.join('، '), 4200);

  if(App.currentView === 'customer') renderCustomerPage(App.activeCustomerId);
  if(App.currentView === 'home') renderHome();

  $('#recordStateLabel').textContent = '🔴 جاري الاستماع...';
  $('#heardText').textContent = (DB.settings.wakeWordEnabled && DB.settings.wakeWord)
    ? `جاهز للعملية التالية... قل «${DB.settings.wakeWord}» ثم الاسم والعملية والمبلغ`
    : 'جاهز للعملية التالية... قل الاسم والعملية والمبلغ';
  currentParsed = null;
  activeParseCtx = null;
  recognitionActiveText = '';
  recognitionProcessed = false;

  startListeningSession();
}

function confirmParsedTransaction(){
  if(!activeParseCtx) return;
  const wrap = $('#prEditWrap');
  let {parsed, customer} = activeParseCtx;
  if(!wrap.hidden){
    customer = DB.customers[$('#editName').value];
    parsed = Object.assign({}, parsed, {
      type: $('#editAction').value,
      amount: parseInt(($('#editAmount').value||'0').replace(/[^\d]/g,''),10) || 0
    });
  }
  const currency = parsed.currency || DEFAULT_CURRENCY;
  addTransaction(customer.id, parsed.type, parsed.amount, {
    currency,
    items: parsed.items || [],
    voiceText: parsed.raw || null,
    note: (parsed.items && parsed.items.length) ? '' : ''
  });

  const newBal = customerBalanceMap(customer.id)[currency] || 0; // بعد الحفظ الآن، بعملة العملية نفسها
  const sign = parsed.type === 'add' ? '+' : '−';
  const symbol = CURRENCY_SYMBOLS[currency] || currency;

  // تحديث أي شاشة خلفية مفتوحة فوراً (صفحة الزبون أو الرئيسية) حتى لو النافذة
  // الصوتية باقية مفتوحة فوق الشاشة
  if(App.currentView === 'customer') renderCustomerPage(App.activeCustomerId);
  if(App.currentView === 'home') renderHome();

  // السلوك الافتراضي دائماً: نبقي النافذة مفتوحة ونعيد الاستماع تلقائياً للعملية
  // التالية، بدل إغلاقها بعد كل عملية — البائع يكمل تسجيل زبون بعد زبون
  // بصوته فقط دون أي ضغط زر إضافي، ويقفل النافذة يدوياً هو لما يخلص فعلاً.
  logQuick(customer.name, parsed.type, parsed.amount, symbol);
  toast(`✓ ${customer.name} ${sign}${fmt(parsed.amount)} ${symbol} — الرصيد الجديد: ${fmt(newBal)} ${symbol}`, 3000);

  $('#parseResult').hidden = true;
  $('#recordStateLabel').textContent = '🔴 جاري الاستماع...';
  $('#heardText').textContent = (DB.settings.wakeWordEnabled && DB.settings.wakeWord)
    ? `جاهز للعملية التالية... قل «${DB.settings.wakeWord}» ثم الاسم والعملية والمبلغ`
    : 'جاهز للعملية التالية... قل الاسم والعملية والمبلغ';
  currentParsed = null;
  activeParseCtx = null;
  recognitionActiveText = '';
  recognitionProcessed = false;

  startListeningSession();
}

function logQuick(name, type, amount, symbol){
  const log = $('#quickModeLog');
  log.hidden = false;
  const item = document.createElement('div');
  item.className = 'ql-item';
  item.textContent = `✓ ${name} ${type==='add'?'+':'−'}${fmt(amount)} ${symbol || CURRENCY_SYMBOLS[DEFAULT_CURRENCY]}`;
  log.prepend(item);
}

/* ============ زر تثبيت التطبيق (PWA) ============ */
let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e)=>{
  e.preventDefault();
  deferredInstallPrompt = e;
  const btn = $('#btnInstallApp');
  if(btn) btn.hidden = false;
});
const installBtn = document.getElementById('btnInstallApp');
if(installBtn){
  installBtn.addEventListener('click', async ()=>{
    if(!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    const choice = await deferredInstallPrompt.userChoice;
    if(choice.outcome === 'accepted') toast('جاري تثبيت التطبيق...');
    deferredInstallPrompt = null;
    installBtn.hidden = true;
  });
}
window.addEventListener('appinstalled', ()=>{
  toast('✓ تم تثبيت التطبيق بنجاح');
  const btn = $('#btnInstallApp');
  if(btn) btn.hidden = true;
});

function applyTheme(){
  const isDark = document.body.classList.contains('dark');
  const sun = document.getElementById('themeIconSun');
  const moon = document.getElementById('themeIconMoon');
  if(sun) sun.hidden = isDark;
  if(moon) moon.hidden = !isDark;
}

function initTheme(){
  if(!DB.settings.themeSet){
    // أول زيارة: نحترم تفضيل نظام تشغيل الجهاز (ليلي/نهاري) تلقائياً
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.body.classList.toggle('dark', prefersDark);
  } else {
    document.body.classList.toggle('dark', !!DB.settings.darkMode);
  }
  applyTheme();
}

const themeToggleBtn = document.getElementById('btnThemeToggle');
if(themeToggleBtn){
  themeToggleBtn.addEventListener('click', ()=>{
    const newDark = !document.body.classList.contains('dark');
    document.body.classList.toggle('dark', newDark);
    DB.settings.darkMode = newDark;
    DB.settings.themeSet = true;
    save();
    applyTheme();
    const setDarkCheckbox = document.getElementById('setDark');
    if(setDarkCheckbox) setDarkCheckbox.checked = newDark;
  });
}

/* =========================================================
   المزامنة اللحظية بين جهازين (WebRTC عبر PeerJS)
   ========================================================= */
let syncPeer = null;
let syncConn = null;
let syncState = 'idle'; // idle | connecting | connected | error

// هوية ثابتة لهذا الجهاز (لا علاقة لها بالبيانات المالية، فقط لتمييز مصدر الرسائل)
function getDeviceId(){
  let id = localStorage.getItem('daftar_device_id');
  if(!id){
    id = uid();
    localStorage.setItem('daftar_device_id', id);
  }
  return id;
}

// يحوّل (اسم القناة + الرقم السري) لمعرّف واحد ثابت غير قابل للتخمين المباشر،
// باستخدام SHA-256 المدمجة بالمتصفح (لا حاجة لأي مكتبة تشفير خارجية)
async function computeChannelId(channel, pin){
  const raw = 'daftar-sync-v1::' + channel.trim() + '::' + pin.trim();
  const enc = new TextEncoder().encode(raw);
  const hashBuf = await crypto.subtle.digest('SHA-256', enc);
  const hex = Array.from(new Uint8Array(hashBuf)).map(b=>b.toString(16).padStart(2,'0')).join('');
  return 'daftar-' + hex.slice(0, 28); // صيغة صالحة لمعرّفات PeerJS (حروف/أرقام فقط)
}

function syncLog(msg){
  const log = document.getElementById('syncLog');
  if(!log) return;
  const item = document.createElement('div');
  item.className = 'ql-item';
  item.textContent = msg;
  log.prepend(item);
}

function setSyncStatus(state, text){
  syncState = state;
  const dot = document.getElementById('syncStatusIndicator');
  const label = document.getElementById('syncStatusText');
  const tileDot = document.getElementById('syncStatusDot');
  if(dot) dot.className = 'sync-dot' + (state === 'connected' ? ' connected' : state === 'connecting' ? ' connecting' : '');
  if(label) label.textContent = text;
  if(tileDot) tileDot.hidden = state !== 'connected';
}

// يُرسِل كل الزبائن والعمليات الحالية للطرف الآخر عند أول اتصال، لتوحيد
// أي تغييرات حصلت على كل جهاز أثناء انقطاعه عن الآخر
function sendFullSync(){
  if(!syncConn || !syncConn.open) return;
  syncConn.send({type:'full_sync_response', payload:{customers: DB.customers, transactions: DB.transactions}});
}

function mergeFullSync(payload){
  if(!payload) return;
  Object.assign(DB.customers, payload.customers || {});
  Object.assign(DB.transactions, payload.transactions || {});
  save();
  refreshVisibleScreens();
  syncLog('✓ تم دمج بيانات الجهاز الآخر');
}

// يُستدعى بعد أي تعديل محلي (إضافة/تعديل/حذف) لبثّه فوراً للطرف المتصل
function broadcastSync(msg){
  if(syncConn && syncConn.open){
    try{ syncConn.send(msg); }catch(e){}
  }
}

function refreshVisibleScreens(){
  if(App.currentView === 'customer') renderCustomerPage(App.activeCustomerId);
  if(App.currentView === 'customers') renderCustomers();
  if(App.currentView === 'home') renderHome();
  if(App.currentView === 'stats') renderStats();
}

function handleSyncMessage(msg){
  if(!msg || !msg.type) return;
  if(msg.type === 'customer_upsert'){
    if(!msg.payload || !msg.payload.id) return;
    DB.customers[msg.payload.id] = msg.payload;
    save();
    refreshVisibleScreens();
    syncLog('↓ تحديث زبون: ' + esc(msg.payload.name));
  } else if(msg.type === 'tx_upsert'){
    if(!msg.payload || !msg.payload.id) return;
    DB.transactions[msg.payload.id] = msg.payload;
    save();
    refreshVisibleScreens();
    syncLog('↓ تحديث عملية مالية');
  } else if(msg.type === 'customer_hard_delete'){
    const id = msg.payload && msg.payload.id;
    if(!id) return;
    delete DB.customers[id];
    Object.keys(DB.transactions).forEach(txId=>{
      if(DB.transactions[txId].customerId === id) delete DB.transactions[txId];
    });
    save();
    refreshVisibleScreens();
    syncLog('↓ حذف زبون من الجهاز الآخر');
  } else if(msg.type === 'full_sync_request'){
    sendFullSync();
  } else if(msg.type === 'full_sync_response'){
    mergeFullSync(msg.payload);
  }
}

function wireDataConnection(conn){
  syncConn = conn;
  conn.on('open', ()=>{
    setSyncStatus('connected', '✅ متصل — يزامن الآن لحظياً');
    syncLog('🔗 تم الاتصال بالجهاز الآخر');
    conn.send({type:'full_sync_request'});
  });
  conn.on('data', handleSyncMessage);
  conn.on('close', ()=>{
    setSyncStatus('idle', 'انقطع الاتصال بالجهاز الآخر');
    syncLog('⚠️ انقطع الاتصال');
    syncConn = null;
  });
  conn.on('error', ()=>{
    setSyncStatus('error', 'حدث خطأ بالاتصال');
  });
}

async function startSync(channel, pin){
  if(typeof Peer === 'undefined'){
    setSyncStatus('error', 'تعذّر تحميل مكتبة الاتصال (تأكد من الإنترنت وأعد المحاولة)');
    return;
  }
  setSyncStatus('connecting', 'جاري الاتصال...');
  const channelId = await computeChannelId(channel, pin);

  // نحاول أولاً "امتلاك" معرّف القناة نفسه: أول جهاز يصل يصبح المضيف
  // وينتظر اتصال الجهاز الثاني، والثاني يتصل به مباشرة تلقائياً
  const hostPeer = new Peer(channelId);
  let settled = false;

  hostPeer.on('open', ()=>{
    settled = true;
    syncPeer = hostPeer;
    syncLog('بانتظار اتصال الجهاز الثاني بنفس القناة...');
    hostPeer.on('connection', conn => wireDataConnection(conn));
  });

  hostPeer.on('error', (err)=>{
    if(settled) return;
    if(err && err.type === 'unavailable-id'){
      // جهاز آخر يملك هذا المعرّف أصلاً: نتصل به كطرف ثانٍ بدل استضافة قناة جديدة
      settled = true;
      try{ hostPeer.destroy(); }catch(e){}
      const clientPeer = new Peer();
      clientPeer.on('open', ()=>{
        syncPeer = clientPeer;
        const conn = clientPeer.connect(channelId, {reliable:true});
        wireDataConnection(conn);
      });
      clientPeer.on('error', ()=>{
        setSyncStatus('error', 'تعذّر الاتصال — تأكد من تطابق اسم القناة والرقم السري بالجهازين');
      });
    } else {
      setSyncStatus('error', 'تعذّر الاتصال (' + (err && err.type || 'خطأ غير معروف') + ')');
    }
  });
}

function stopSync(){
  try{ if(syncConn) syncConn.close(); }catch(e){}
  try{ if(syncPeer) syncPeer.destroy(); }catch(e){}
  syncConn = null;
  syncPeer = null;
  setSyncStatus('idle', 'غير متصل');
}

const formSyncConnect = document.getElementById('formSyncConnect');
if(formSyncConnect){
  formSyncConnect.addEventListener('submit', e=>{
    e.preventDefault();
    const channel = document.getElementById('syncChannelInput').value.trim();
    const pin = document.getElementById('syncPinInput').value.trim();
    if(!channel || pin.length < 4) return;
    DB.settings.syncChannel = channel;
    save();
    document.getElementById('btnSyncConnect').disabled = true;
    formSyncConnect.querySelectorAll('input').forEach(i=> i.disabled = true);
    document.getElementById('btnSyncDisconnect').hidden = false;
    startSync(channel, pin);
  });
}
const btnSyncDisconnect = document.getElementById('btnSyncDisconnect');
if(btnSyncDisconnect){
  btnSyncDisconnect.addEventListener('click', ()=>{
    stopSync();
    document.getElementById('btnSyncConnect').disabled = false;
    formSyncConnect.querySelectorAll('input').forEach(i=> i.disabled = false);
    btnSyncDisconnect.hidden = true;
  });
}

function renderSyncView(){
  const channelInput = document.getElementById('syncChannelInput');
  if(channelInput && DB.settings.syncChannel) channelInput.value = DB.settings.syncChannel;
}

/* ============ تهيئة أولية ============ */
function init(){
  if(!isSecureContextForVoice()){
    const w = document.getElementById('voiceWarning');
    if(w) w.hidden = false;
  }
  initTheme();
  if(DB.settings.pin){
    const entered = prompt('أدخل الرقم السري لفتح الدفتر:');
    if(entered !== DB.settings.pin){
      document.body.innerHTML = '<div style="padding:40px;text-align:center;font-family:sans-serif">🔒 رقم سري غير صحيح. أعد تحميل الصفحة للمحاولة مجدداً.</div>';
      return;
    }
  }
  navigate('home');

  // تسجيل service worker للعمل بدون إنترنت (يفشل بصمت إن لم يكن مدعوماً)
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('sw.js').catch(()=>{});
  }
}

init();

// إتاحة بعض الدوال للتصحيح من الكونسول عند الحاجة
window.__daftar = { DB, wordsToNumber, parseCommand };

})();
