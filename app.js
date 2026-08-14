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
    settings: { darkMode:false, themeSet:false, quickMode:true, continuous:false, shopName:'', pin:'' }
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

/* ============ منطق الحسابات ============ */
function customerBalance(customerId){
  const c = DB.customers[customerId];
  if(!c) return 0;
  let bal = Number(c.openingBalance) || 0;
  const txs = Object.values(DB.transactions)
    .filter(t => t.customerId === customerId && !t.deleted)
    .sort((a,b)=> a.date - b.date);
  for(const t of txs){
    bal += (t.type === 'add') ? t.amount : -t.amount;
  }
  return bal;
}

function customerTxs(customerId, includeDeleted=false){
  return Object.values(DB.transactions)
    .filter(t => t.customerId === customerId && (includeDeleted || !t.deleted))
    .sort((a,b)=> b.date - a.date);
}

function runningBalances(customerId){
  const c = DB.customers[customerId];
  let bal = Number(c.openingBalance) || 0;
  const txs = customerTxs(customerId).slice().sort((a,b)=> a.date - b.date);
  const out = [];
  for(const t of txs){
    bal += (t.type === 'add') ? t.amount : -t.amount;
    out.push({tx:t, balance:bal});
  }
  return out.reverse();
}

function totalDebt(){
  return Object.keys(DB.customers).reduce((s,id)=> s + Math.max(0, customerBalance(id)), 0);
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
}

/* ============ الشاشة الرئيسية ============ */
function renderHome(){
  $('#homeTotalDebt').textContent = fmt(totalDebt()) + ' ل.س';
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
      const row = document.createElement('div');
      row.className = 'recent-item';
      row.innerHTML = `<span>${c ? esc(c.name) : '—'}</span>
        <b class="${t.type==='add'?'amt-add':'amt-sub'}">${t.type==='add'?'+':'−'}${fmt(t.amount)}</b>`;
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

  list = list.map(c => ({c, bal: customerBalance(c.id), last: lastTxDate(c.id)}));

  if(sortBy === 'name') list.sort((a,b)=> a.c.name.localeCompare(b.c.name,'ar'));
  if(sortBy === 'debtDesc') list.sort((a,b)=> b.bal - a.bal);
  if(sortBy === 'debtAsc') list.sort((a,b)=> a.bal - b.bal);
  if(sortBy === 'recent') list.sort((a,b)=> (b.last||0) - (a.last||0));

  const wrap = $('#customerList');
  wrap.innerHTML = '';
  $('#customersEmpty').hidden = list.length > 0;

  list.forEach(({c,bal,last})=>{
    const row = document.createElement('div');
    row.className = 'customer-row';
    const cls = bal > 0 ? 'pos' : (bal < 0 ? 'neg' : 'zero');
    row.innerHTML = `
      <div class="cav">${esc(c.name.trim()[0] || '؟')}</div>
      <div class="cinfo">
        <div class="cname">${esc(c.name)}</div>
        <div class="clast">${last ? 'آخر عملية: '+fmtDate(last) : 'لا عمليات بعد'}</div>
      </div>
      <div class="cbal ${cls}">${fmt(bal)}</div>`;
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

  const bal = customerBalance(id);
  $('#custBalance').textContent = fmt(bal);
  $('#balanceCard').style.background = bal < 0
    ? 'linear-gradient(135deg,#1F4433,#2F6E4E)'
    : 'linear-gradient(135deg, var(--ink), var(--ink-3))';

  const rows = runningBalances(id);
  const wrap = $('#txTable');
  wrap.innerHTML = '';
  $('#txEmpty').hidden = rows.length > 0;

  rows.forEach(({tx,balance})=>{
    const row = document.createElement('div');
    row.className = 'tx-row';
    const sign = tx.type === 'add' ? '+' : '−';
    const cls = tx.type === 'add' ? 'amt-add' : 'amt-sub';
    let itemsLine = '';
    if(tx.items && tx.items.length){
      itemsLine = `<div class="tx-note">${tx.items.map(i=>`${esc(i.name)}: ${fmt(i.amount)}`).join('، ')}</div>`;
    }
    row.innerHTML = `
      <div class="tx-top">
        <span class="tx-date">${fmtDateTime(tx.date)}</span>
        <b class="tx-amt ${cls}">${sign}${fmt(tx.amount)}</b>
      </div>
      <div class="tx-bal">الرصيد بعد العملية: ${fmt(balance)}</div>
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
  DB.customers[App.activeCustomerId].notes = ((DB.customers[App.activeCustomerId].notes||'') + '\n' + note).trim();
  save();
  toast('تم حفظ الملاحظة');
});

$('#btnCustPhoto').addEventListener('click', ()=> toast('إضافة الصور تحتاج تشغيل التطبيق كتطبيق مثبت (APK) للوصول للكاميرا.'));

$('#btnCustInvoice').addEventListener('click', ()=> printCustomerStatement(App.activeCustomerId, 'فاتورة'));
$('#btnCustPrint').addEventListener('click', ()=> printCustomerStatement(App.activeCustomerId, 'كشف حساب'));

$('#btnCustShare').addEventListener('click', ()=>{
  const c = DB.customers[App.activeCustomerId];
  const bal = customerBalance(c.id);
  const rows = runningBalances(c.id).slice(0,10).reverse();
  let text = `كشف حساب ${c.name}\n`;
  rows.forEach(({tx,balance})=>{
    text += `${tx.type==='add'?'إضافة':'دفعة'}: ${fmt(tx.amount)} — الرصيد: ${fmt(balance)}\n`;
  });
  text += `\nالمتبقي: ${fmt(bal)} ل.س`;
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
  renderCustomerPage(c.id);
});

$('#btnDeleteCustomer').addEventListener('click', ()=>{
  const c = DB.customers[App.activeCustomerId];
  if(!c) return;
  const bal = customerBalance(c.id);
  const balWarning = bal !== 0
    ? `\n\n⚠️ تنبيه: رصيد "${c.name}" الحالي هو ${fmt(bal)} ل.س — سيُحذف نهائياً مع كامل سجل عملياته ولن تقدر تسترجعه.`
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
}

function printCustomerStatement(customerId, title){
  const c = DB.customers[customerId];
  const shopName = DB.settings.shopName || 'دفتر الديون الصوتي';
  const rows = runningBalances(customerId).slice().reverse();
  const bal = customerBalance(customerId);
  let html = `<div style="font-family:sans-serif;direction:rtl">
    <h2>${esc(shopName)}</h2>
    <h3>${esc(title)} — ${esc(c.name)}</h3>
    <p>التاريخ: ${fmtDate(Date.now())} ${c.phone ? '| الهاتف: '+esc(c.phone) : ''}</p>
    <table style="width:100%;border-collapse:collapse" border="1" cellpadding="6">
      <tr><th>التاريخ</th><th>العملية</th><th>المبلغ</th><th>الرصيد</th></tr>`;
  rows.forEach(({tx,balance})=>{
    html += `<tr><td>${fmtDate(tx.date)}</td><td>${tx.type==='add'?'إضافة':'دفعة'}</td><td>${fmt(tx.amount)}</td><td>${fmt(balance)}</td></tr>`;
  });
  html += `</table><h3>الإجمالي المتبقي: ${fmt(bal)} ل.س</h3></div>`;
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
  return id;
}

function addTransaction(customerId, type, amount, extra={}){
  const id = uid();
  DB.transactions[id] = Object.assign({
    id, customerId, type, amount, date: Date.now(), deleted:false, items:[]
  }, extra);
  save();
  return id;
}

/* ============ الإحصائيات ============ */
function renderStats(){
  const custs = Object.values(DB.customers);
  const allTx = Object.values(DB.transactions).filter(t=>!t.deleted);
  const todayStr = new Date().toDateString();
  const monthKey = new Date().toISOString().slice(0,7);

  const totalD = totalDebt();
  const totalPaid = allTx.filter(t=>t.type==='subtract').reduce((s,t)=>s+t.amount,0);
  const debtToday = allTx.filter(t=>t.type==='add' && new Date(t.date).toDateString()===todayStr).reduce((s,t)=>s+t.amount,0);
  const paidToday = allTx.filter(t=>t.type==='subtract' && new Date(t.date).toDateString()===todayStr).reduce((s,t)=>s+t.amount,0);
  const debtMonth = allTx.filter(t=>t.type==='add' && new Date(t.date).toISOString().slice(0,7)===monthKey).reduce((s,t)=>s+t.amount,0);
  const paidMonth = allTx.filter(t=>t.type==='subtract' && new Date(t.date).toISOString().slice(0,7)===monthKey).reduce((s,t)=>s+t.amount,0);

  const stats = [
    ['إجمالي الديون', totalD],
    ['إجمالي المدفوع (كل الوقت)', totalPaid],
    ['عدد الزبائن', custs.length],
    ['ديون اليوم', debtToday],
    ['دفعات اليوم', paidToday],
    ['ديون هذا الشهر', debtMonth],
    ['دفعات هذا الشهر', paidMonth],
  ];
  const grid = $('#statGrid');
  grid.innerHTML = stats.map(([l,v])=>`
    <div class="stat-card"><span class="sc-label">${l}</span><span class="sc-value">${fmt(v)}</span></div>`).join('');

  const top = custs.map(c=>({c, bal:customerBalance(c.id)}))
    .sort((a,b)=> b.bal - a.bal).slice(0,10);
  const wrap = $('#topDebtsList');
  wrap.innerHTML = '';
  top.forEach(({c,bal})=>{
    const row = document.createElement('div');
    row.className = 'customer-row';
    row.innerHTML = `<div class="cav">${esc(c.name.trim()[0]||'؟')}</div>
      <div class="cinfo"><div class="cname">${esc(c.name)}</div></div>
      <div class="cbal pos">${fmt(bal)}</div>`;
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
      DB.transactions[btn.dataset.restore].deleted = false;
      save();
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
    DB.customers[b.dataset.clear].reminderDate = null; save(); renderReminders();
  }));
}

/* ============ الإعدادات ============ */
function renderSettingsForm(){
  $('#setDark').checked = !!DB.settings.darkMode;
  $('#setQuick').checked = !!DB.settings.quickMode;
  $('#setContinuous').checked = !!DB.settings.continuous;
  $('#setShopName').value = DB.settings.shopName || '';
  $('#setPin').value = '';
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
$('#setShopName').addEventListener('input', e=>{ DB.settings.shopName = e.target.value; save(); });
$('#setPin').addEventListener('change', e=>{ DB.settings.pin = e.target.value.trim(); save(); toast(DB.settings.pin ? 'تم تفعيل القفل' : 'تم إلغاء القفل'); });

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

function setupSpeechRecognition(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SR || !isSecureContextForVoice()){ recognitionSupported = false; return; }
  recognitionSupported = true;
  recognition = new SR();
  recognition.lang = 'ar-SA';
  recognition.interimResults = true;
  // نُبقي الاستماع مستمراً دائماً (بدل الاعتماد على "isFinal" اللي يقطع الكلام
  // عند أول توقف قصير بين الكلمات) ونتحكم نحن بلحظة الانتهاء عبر مؤقت صمت خاص بنا
  recognition.continuous = true;
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
      $('#recordStateLabel').textContent = '🔇 لم أسمع أي صوت';
      $('#heardText').textContent = 'لم يصلني أي صوت. اضغط الختم للمحاولة مجدداً، أو استخدم الكتابة بالأسفل.';
      showTypeFallback();
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
  handleRecognizedText(text);
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
  $('#heardText').textContent = 'قل شيئاً مثل: «محمد إضافة خمسين ألف»';
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
  const prevBal = customerBalance(customer.id);
  const newBal = parsed.type === 'add' ? prevBal + parsed.amount : prevBal - parsed.amount;

  $('#parseResult').hidden = false;
  $('#prName').textContent = customer.name;
  $('#prAction').textContent = parsed.type === 'add' ? 'إضافة دين' : 'طرح / دفعة';
  $('#prAmount').textContent = fmt(parsed.amount) + ' ل.س';
  if(parsed.items && parsed.items.length){
    $('#prItemsRow').hidden = false;
    $('#prItems').textContent = parsed.items.map(i=>`${i.name} (${fmt(i.amount)})`).join('، ');
  } else {
    $('#prItemsRow').hidden = true;
  }
  $('#prPrev').textContent = fmt(prevBal);
  $('#prNew').textContent = fmt(newBal);
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
    addTransaction(customer.id, cmd.type, cmd.amount, {voiceText: rawText, items: []});
    const newBal = customerBalance(customer.id);
    const sign = cmd.type === 'add' ? '+' : '−';
    logQuick(customer.name, cmd.type, cmd.amount);
    summary.push(`${customer.name} ${sign}${fmt(cmd.amount)}`);
  });

  toast(`✓ تم تسجيل ${commands.length} عمليات: ` + summary.join('، '), 4200);

  if(App.currentView === 'customer') renderCustomerPage(App.activeCustomerId);
  if(App.currentView === 'home') renderHome();

  $('#recordStateLabel').textContent = '🔴 جاري الاستماع...';
  $('#heardText').textContent = 'جاهز للعملية التالية... قل الاسم والعملية والمبلغ';
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
  addTransaction(customer.id, parsed.type, parsed.amount, {
    items: parsed.items || [],
    voiceText: parsed.raw || null,
    note: (parsed.items && parsed.items.length) ? '' : ''
  });

  const newBal = customerBalance(customer.id); // بعد الحفظ الآن (addTransaction تم فوق)
  const sign = parsed.type === 'add' ? '+' : '−';

  // تحديث أي شاشة خلفية مفتوحة فوراً (صفحة الزبون أو الرئيسية) حتى لو النافذة
  // الصوتية باقية مفتوحة فوق الشاشة
  if(App.currentView === 'customer') renderCustomerPage(App.activeCustomerId);
  if(App.currentView === 'home') renderHome();

  // السلوك الافتراضي دائماً: نبقي النافذة مفتوحة ونعيد الاستماع تلقائياً للعملية
  // التالية، بدل إغلاقها بعد كل عملية — البائع يكمل تسجيل زبون بعد زبون
  // بصوته فقط دون أي ضغط زر إضافي، ويقفل النافذة يدوياً هو لما يخلص فعلاً.
  logQuick(customer.name, parsed.type, parsed.amount);
  toast(`✓ ${customer.name} ${sign}${fmt(parsed.amount)} — الرصيد الجديد: ${fmt(newBal)}`, 3000);

  $('#parseResult').hidden = true;
  $('#recordStateLabel').textContent = '🔴 جاري الاستماع...';
  $('#heardText').textContent = 'جاهز للعملية التالية... قل الاسم والعملية والمبلغ';
  currentParsed = null;
  activeParseCtx = null;
  recognitionActiveText = '';
  recognitionProcessed = false;

  startListeningSession();
}

function logQuick(name, type, amount){
  const log = $('#quickModeLog');
  log.hidden = false;
  const item = document.createElement('div');
  item.className = 'ql-item';
  item.textContent = `✓ ${name} ${type==='add'?'+':'−'}${fmt(amount)}`;
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
