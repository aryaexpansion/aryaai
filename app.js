/* ============================================================
   ARYA AI v3.0 — app.js — Arya Expansion Software
   ============================================================ */

/* ---- STATE ---- */
const S = {
  apiKey: '',
  user: null,
  credits: 100,
  creditsMax: 100,
  creditsDate: '',
  voiceGender: 'male',
  ttsActive: false,
  voiceActive: false,
  thinkMode: false,
  loopMode: false,
  currentPage: 'chat',
  messages: [],
  memory: [],
  searchHistory: [],
  trainedContext: [],
  stats: { chats: 0, images: 0, music: 0, daysActive: 0 },
  visionBase64: null,
  audioCtx: null,
  musicPlaying: false,
  musicNodes: [],
  musicBuffers: {},
  vizType: 'bars',
  analyser: null,
  vizFrame: null,
  currentMusicTrack: null,
  musicLibrary: [],
  prefs: {}
};

/* ---- BOOT ---- */
window.addEventListener('DOMContentLoaded', () => {
  loadState();
  startSplash();
});

function startSplash() {
  const msgs = [
    'Quantum çekirdek başlatılıyor...',
    'Sinir ağları yükleniyor...',
    'Türkçe dil modeli aktif...',
    'Müzik sentez motoru hazır...',
    'ARYA AI hazır!'
  ];
  let i = 0;
  const el = document.getElementById('splash-status');
  const iv = setInterval(() => {
    if (el && msgs[i]) el.textContent = msgs[i];
    i++;
    if (i >= msgs.length) {
      clearInterval(iv);
      setTimeout(hideSplash, 400);
    }
  }, 480);
}

function hideSplash() {
  const splash = document.getElementById('splash');
  if (splash) {
    splash.classList.add('fade-out');
    setTimeout(() => {
      splash.style.display = 'none';
      document.getElementById('app').classList.remove('hidden');
      initApp();
    }, 800);
  }
}

function initApp() {
  startQuantumBg();
  refreshCreditsBar();
  refreshSidebarStats();
  updateModelBadge();
  renderMemoryList();

  if (!S.user) {
    setTimeout(() => {
      document.getElementById('auth-modal').classList.remove('hidden');
    }, 600);
  } else {
    applyUserToUI();
  }

  if (!S.apiKey) {
    document.getElementById('api-banner').classList.remove('hidden');
  }
}

/* ---- PERSIST ---- */
function loadState() {
  try {
    S.apiKey = localStorage.getItem('arya_apikey') || '';
    S.voiceGender = localStorage.getItem('arya_vg') || 'male';
    S.credits = parseInt(localStorage.getItem('arya_credits') || '100');
    S.creditsMax = 100;
    S.creditsDate = localStorage.getItem('arya_cdate') || '';
    S.memory = JSON.parse(localStorage.getItem('arya_memory') || '[]');
    S.searchHistory = JSON.parse(localStorage.getItem('arya_history') || '[]');
    S.trainedContext = JSON.parse(localStorage.getItem('arya_context') || '[]');
    S.stats = JSON.parse(localStorage.getItem('arya_stats') || '{"chats":0,"images":0,"music":0,"daysActive":0}');
    S.musicLibrary = JSON.parse(localStorage.getItem('arya_musiclib') || '[]');
    const u = localStorage.getItem('arya_user');
    if (u) S.user = JSON.parse(u);

    // daily credit reset
    const today = new Date().toDateString();
    if (S.creditsDate !== today) {
      S.credits = 100;
      S.creditsDate = today;
      localStorage.setItem('arya_credits', '100');
      localStorage.setItem('arya_cdate', today);
    }

    if (S.apiKey) {
      document.getElementById('openai-key') && (document.getElementById('openai-key').value = S.apiKey);
    }
  } catch(e) { console.warn('State load error', e); }
}

function saveState() {
  try {
    localStorage.setItem('arya_apikey', S.apiKey);
    localStorage.setItem('arya_vg', S.voiceGender);
    localStorage.setItem('arya_credits', S.credits);
    localStorage.setItem('arya_cdate', S.creditsDate);
    localStorage.setItem('arya_memory', JSON.stringify(S.memory));
    localStorage.setItem('arya_history', JSON.stringify(S.searchHistory));
    localStorage.setItem('arya_context', JSON.stringify(S.trainedContext));
    localStorage.setItem('arya_stats', JSON.stringify(S.stats));
    localStorage.setItem('arya_musiclib', JSON.stringify(S.musicLibrary));
    if (S.user) localStorage.setItem('arya_user', JSON.stringify(S.user));
  } catch(e) {}
}

/* ---- AUTH ---- */
function switchTab(tab) {
  document.getElementById('auth-login').classList.toggle('hidden', tab !== 'login');
  document.getElementById('auth-register').classList.toggle('hidden', tab !== 'register');
  document.getElementById('tab-login').classList.toggle('active', tab === 'login');
  document.getElementById('tab-register').classList.toggle('active', tab === 'register');
  document.getElementById('auth-error').classList.add('hidden');
}

function doLogin() {
  const email = document.getElementById('login-email').value.trim();
  const pass = document.getElementById('login-pass').value;
  if (!email || !pass) { showAuthError('E-posta ve şifre gerekli.'); return; }
  const stored = JSON.parse(localStorage.getItem('arya_accounts') || '[]');
  const acc = stored.find(a => a.email === email && a.pass === btoa(pass));
  if (!acc) { showAuthError('E-posta veya şifre hatalı.'); return; }
  S.user = { name: acc.name, email: acc.email, plan: acc.plan || 'free' };
  saveState();
  closeAuthModal();
  applyUserToUI();
  toast('Hoş geldiniz, ' + acc.name + '!', 'ok');
}

function doRegister() {
  const name = document.getElementById('reg-name').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const pass = document.getElementById('reg-pass').value;
  if (!name || !email || !pass) { showAuthError('Tüm alanlar gerekli.'); return; }
  if (pass.length < 8) { showAuthError('Şifre en az 8 karakter olmalı.'); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showAuthError('Geçerli bir e-posta girin.'); return; }
  const stored = JSON.parse(localStorage.getItem('arya_accounts') || '[]');
  if (stored.find(a => a.email === email)) { showAuthError('Bu e-posta zaten kayıtlı.'); return; }
  stored.push({ name, email, pass: btoa(pass), plan: 'free', joined: new Date().toISOString() });
  localStorage.setItem('arya_accounts', JSON.stringify(stored));
  S.user = { name, email, plan: 'free' };
  saveState();
  closeAuthModal();
  applyUserToUI();
  toast('Kayıt başarılı! Hoş geldiniz, ' + name + '!', 'ok');
}

function doGoogleLogin() {
  const name = 'Google Kullanıcısı';
  const email = 'user@gmail.com';
  S.user = { name, email, plan: 'free' };
  saveState();
  closeAuthModal();
  applyUserToUI();
  toast('Google ile giriş yapıldı!', 'ok');
}

function doLogout() {
  S.user = null;
  localStorage.removeItem('arya_user');
  document.getElementById('profile-modal').classList.add('hidden');
  applyUserToUI();
  document.getElementById('auth-modal').classList.remove('hidden');
  toast('Çıkış yapıldı.', 'ok');
}

function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function closeAuthModal() {
  document.getElementById('auth-modal').classList.add('hidden');
}

function dismissAuth() {
  closeAuthModal();
}

function applyUserToUI() {
  const name = S.user ? S.user.name : 'Misafir';
  const letter = name.charAt(0).toUpperCase();
  const plan = S.user ? (S.user.plan === 'pro' ? 'Quantum Pro' : 'Ücretsiz Plan') : 'Demo Mod';

  document.getElementById('avatar-letter').textContent = letter;
  document.getElementById('sidebar-username').textContent = name;
  document.getElementById('user-plan').textContent = plan;

  const lb = document.getElementById('login-btn');
  const pb = document.getElementById('profile-btn');
  if (S.user) {
    lb && lb.classList.add('hidden');
    pb && pb.classList.remove('hidden');
  } else {
    lb && lb.classList.remove('hidden');
    pb && pb.classList.add('hidden');
  }
}

/* ---- PROFILE ---- */
function openProfile() {
  if (!S.user) { document.getElementById('auth-modal').classList.remove('hidden'); return; }
  document.getElementById('profile-name-display').textContent = S.user.name;
  document.getElementById('profile-email-display').textContent = S.user.email;
  document.getElementById('profile-plan-display').textContent = S.user.plan === 'pro' ? 'Quantum Pro' : 'Ücretsiz Plan';
  document.getElementById('profile-avatar-large').textContent = S.user.name.charAt(0).toUpperCase();
  document.getElementById('ps-chats').textContent = S.stats.chats;
  document.getElementById('ps-images').textContent = S.stats.images;
  document.getElementById('ps-music').textContent = S.stats.music;
  document.getElementById('ps-days').textContent = S.stats.daysActive || 1;

  // search history
  const sh = document.getElementById('search-history');
  if (sh) {
    if (S.searchHistory.length === 0) {
      sh.innerHTML = '<div style="color:var(--text-muted);font-size:.78rem;padding:8px">Henüz arama yok.</div>';
    } else {
      sh.innerHTML = S.searchHistory.slice(-10).reverse().map(h =>
        `<div class="sh-item"><span>◈</span><span style="flex:1">${escHtml(h.text.substring(0,60))}</span><span class="sh-time">${h.time}</span></div>`
      ).join('');
    }
  }

  // sub info
  const si = document.getElementById('sub-info');
  if (si) {
    si.innerHTML = S.user.plan === 'pro'
      ? '<span style="color:var(--success)">✓ Quantum Pro aktif — Sınırsız erişim</span>'
      : `<span>Ücretsiz Plan — <strong style="color:var(--q-primary)">${S.credits}</strong>/100 kredi kaldı bu gün.</span>`;
  }

  document.getElementById('profile-modal').classList.remove('hidden');
}

/* ---- API KEY ---- */
function saveApiKeyFromModal() {
  const key = document.getElementById('modal-api-key').value.trim();
  if (!key.startsWith('sk-')) {
    document.getElementById('modal-key-status').innerHTML = '<span style="color:var(--danger)">Geçersiz format. sk- ile başlamalı.</span>';
    return;
  }
  S.apiKey = key;
  saveState();
  document.getElementById('modal-key-status').innerHTML = '<span style="color:var(--success)">✓ API anahtarı kaydedildi!</span>';
  document.getElementById('api-stat').textContent = 'Aktif';
  document.getElementById('api-stat').style.color = 'var(--success)';
  document.getElementById('api-banner').classList.add('hidden');
  document.getElementById('api-key-status').textContent = key.substring(0,8) + '...';
  document.getElementById('api-key-status').style.color = 'var(--success)';
  if (document.getElementById('openai-key')) document.getElementById('openai-key').value = key;
  setTimeout(() => document.getElementById('api-modal').classList.add('hidden'), 1000);
  toast('API anahtarı aktifleştirildi!', 'ok');
}

function validateKeyInput() {
  const key = document.getElementById('modal-api-key').value.trim();
  const el = document.getElementById('modal-key-status');
  if (key.length < 3) { el.textContent = ''; return; }
  el.innerHTML = key.startsWith('sk-')
    ? '<span style="color:var(--success)">✓ Format geçerli</span>'
    : '<span style="color:var(--warning)">Format: sk-proj-...</span>';
}

function saveApiKey() {
  const key = document.getElementById('openai-key').value.trim();
  if (!key) { toast('API anahtarı boş olamaz.', 'warn'); return; }
  if (!key.startsWith('sk-')) { toast('Geçersiz format. sk- ile başlamalı.', 'err'); return; }
  S.apiKey = key;
  saveState();
  document.getElementById('api-key-status').textContent = key.substring(0,8) + '...';
  document.getElementById('api-key-status').style.color = 'var(--success)';
  document.getElementById('api-stat').textContent = 'Aktif';
  document.getElementById('api-stat').style.color = 'var(--success)';
  document.getElementById('api-banner').classList.add('hidden');
  toast('API anahtarı kaydedildi!', 'ok');
}

function dismissApiModal() {
  document.getElementById('api-modal').classList.add('hidden');
}

/* ---- CREDITS ---- */
function useCredit(amount) {
  if (S.user && S.user.plan === 'pro') return true;
  if (S.credits < amount) {
    toast('Yetersiz kredi! Pro plana geçin.', 'warn');
    document.getElementById('sub-modal').classList.remove('hidden');
    return false;
  }
  S.credits -= amount;
  saveState();
  refreshCreditsBar();
  return true;
}

function refreshCreditsBar() {
  const pct = Math.max(0, (S.credits / S.creditsMax) * 100);
  const prog = document.getElementById('cb-progress');
  const count = document.getElementById('cb-count');
  const stat = document.getElementById('credits-stat');
  if (prog) prog.style.width = pct + '%';
  if (count) count.textContent = S.credits + '/100';
  if (stat) stat.textContent = S.credits;
  if (prog) prog.style.background = pct < 20
    ? 'linear-gradient(90deg,var(--danger),var(--warning))'
    : 'linear-gradient(90deg,var(--q-primary),var(--q-accent))';
}

function refreshSidebarStats() {
  document.getElementById('mem-count').textContent = S.memory.length + ' kayıt';
  document.getElementById('api-stat').textContent = S.apiKey ? 'Aktif' : 'KB Modu';
  if (S.apiKey) document.getElementById('api-stat').style.color = 'var(--success)';
  // Mind stats
  if (window.getMindStats) {
    const ms = window.getMindStats();
    const engineEl = document.getElementById('engine-status');
    if (engineEl && !ms.ready && !ms.loading) {
      engineEl.style.cursor = 'pointer';
      engineEl.title = 'Tıkla: AI modeli indir';
      engineEl.onclick = () => window.loadMindModel && window.loadMindModel();
    }
  }
}

/* ---- PAGES ---- */
function showPage(id) {
  S.currentPage = id;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const pg = document.getElementById('page-' + id);
  if (pg) pg.classList.add('active');
  const ni = document.querySelector(`[data-page="${id}"]`);
  if (ni) ni.classList.add('active');
  const titles = { chat:'Quantum Chat', vision:'Görsel Analiz', video:'Video Üretim', music:'Müzik Stüdyo', memory:'Hafıza', train:'AI Eğitim', think:'Derin Düşünce', settings:'Ayarlar' };
  const pt = document.getElementById('page-title');
  if (pt) pt.textContent = titles[id] || 'ARYA AI';
  if (id === 'memory') renderMemoryList();
  if (id === 'train') renderContextList();
  if (window.innerWidth <= 900) closeSidebar();
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
}

function clearCurrentPage() {
  if (S.currentPage === 'chat') {
    S.messages = [];
    document.getElementById('chat-messages').innerHTML = '';
    showWelcomeCard();
  }
}

function showWelcomeCard() {
  const msgs = document.getElementById('chat-messages');
  msgs.innerHTML = `<div class="welcome-card" id="welcome-card">
    <div class="wc-rings"><div class="wc-ring wcr1"></div><div class="wc-ring wcr2"></div><div class="wc-ring wcr3"></div></div>
    <h2 class="wc-title">ARYA AI'ya Hoş Geldiniz</h2>
    <p class="wc-sub">GPT-4o destekli Quantum Zeka Modeli — Türkçe, akıllı, hızlı.</p>
    <div class="wc-caps">
      <div class="cap"><span class="cap-icon">◈</span>GPT-4o Streaming</div>
      <div class="cap"><span class="cap-icon">◈</span>DALL-E 3 Görsel</div>
      <div class="cap"><span class="cap-icon">◈</span>Vision Analizi</div>
      <div class="cap"><span class="cap-icon">◈</span>Türkçe Sesli Yanıt</div>
      <div class="cap"><span class="cap-icon">◈</span>Sonsuz Hafıza</div>
      <div class="cap"><span class="cap-icon">◈</span>100 Kredi/Gün</div>
    </div>
    <div class="wc-suggestions">
      <button class="suggestion-btn" onclick="fillInput('Kuantum hesaplama nedir?')">Kuantum hesaplama</button>
      <button class="suggestion-btn" onclick="fillInput('Python ile neural network kodu yaz.')">Neural network yaz</button>
      <button class="suggestion-btn" onclick="fillInput('Bana kısa hüzünlü bir şiir yaz.')">Şiir yaz</button>
      <button class="suggestion-btn" onclick="fillInput('Yapay zekanın geleceğini anlat.')">AI geleceği</button>
    </div>
  </div>`;
}

/* ---- CHAT ---- */
function fillInput(text) {
  const inp = document.getElementById('chat-input');
  inp.value = text;
  inp.focus();
  autoResize(inp);
}

function handleKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 180) + 'px';
}

async function sendMessage() {
  const inp = document.getElementById('chat-input');
  const text = inp.value.trim();
  if (!text && !S.visionBase64) return;
  if (!useCredit(1)) return;

  if (text) {
    addToSearchHistory(text);
    S.stats.chats++;
    saveState();
  }

  const wc = document.getElementById('welcome-card');
  if (wc) wc.remove();

  const userMsg = { role: 'user', content: text, img: S.visionBase64 };
  S.messages.push(userMsg);
  renderUserMessage(text, S.visionBase64);

  inp.value = '';
  inp.style.height = 'auto';
  const savedImg = S.visionBase64;
  S.visionBase64 = null;
  document.getElementById('image-preview-chip').classList.add('hidden');

  const btn = document.getElementById('send-btn');
  btn.disabled = true;
  setQiThinking(true);

  const typingId = 'typing-' + Date.now();
  addTypingIndicator(typingId);

  try {
    const reply = await callOpenAI(text, savedImg);
    removeTypingIndicator(typingId);
    renderAryaMessage(reply);
    S.messages.push({ role: 'assistant', content: reply });
    saveToMemory(text, reply);
    if (S.ttsActive) speakText(reply);
  } catch(e) {
    removeTypingIndicator(typingId);
    renderAryaMessage('⚠️ ' + e.message, true);
  }

  btn.disabled = false;
  setQiThinking(false);
}

async function callOpenAI(text, imgBase64) {
  // 1. Yerel Quantum AI motoru (API key gerektirmez)
  if (!imgBase64 && window.aryaMindAnswer) {
    try {
      const mindReply = await window.aryaMindAnswer(text);
      if (mindReply && mindReply.length > 5) return mindReply;
    } catch(e) { console.warn('Mind engine error:', e.message); }
  }

  // 2. OpenAI API (isteğe bağlı — görsel analiz veya bonus güç)
  if (!S.apiKey) return getDemoReply(text);

  const model = document.getElementById('model-select')?.value || 'gpt-4o';
  const temp = (document.getElementById('temp-range')?.value || 70) / 100;
  const persona = getPersonaPrompt();

  const msgs = [{ role: 'system', content: persona }];

  // Add memory context
  if (S.memory.length > 0) {
    const ctx = S.memory.slice(-8).map(m => m.text).join('\n');
    msgs.push({ role: 'system', content: 'Kullanıcı bağlamı:\n' + ctx });
  }

  // trained context
  if (S.trainedContext.length > 0) {
    const ctx = S.trainedContext.map(c => c.content).join('\n').substring(0, 3000);
    msgs.push({ role: 'system', content: 'Yüklü bilgi tabanı:\n' + ctx });
  }

  // conversation history
  S.messages.slice(-10).forEach(m => {
    if (m.role === 'user') {
      if (m.img) {
        msgs.push({ role: 'user', content: [
          { type: 'text', text: m.content || 'Bu görseli analiz et.' },
          { type: 'image_url', image_url: { url: m.img } }
        ]});
      } else {
        msgs.push({ role: 'user', content: m.content });
      }
    } else if (m.role === 'assistant') {
      msgs.push({ role: 'assistant', content: m.content });
    }
  });

  const currentMsg = { role: 'user', content: imgBase64
    ? [{ type: 'text', text: text || 'Bu görseli analiz et.' }, { type: 'image_url', image_url: { url: imgBase64 } }]
    : text };
  msgs.push(currentMsg);

  const useModel = imgBase64 && model === 'gpt-4o-mini' ? 'gpt-4o' : model;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + S.apiKey },
    body: JSON.stringify({ model: useModel, messages: msgs, temperature: temp, max_tokens: 2000, stream: false })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || 'API Hatası: ' + res.status);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || '(Yanıt alınamadı)';
}

function getPersonaPrompt() {
  const p = document.getElementById('personality-select')?.value || 'default';
  const base = 'Sen ARYA AI\'sın — Arya Expansion tarafından geliştirilen quantum zeka modelisin. Türk Dil Kurumu kurallarına uygun, kusursuz, akıcı Türkçe konuşursun. Her zaman yardımcı, zeki ve içten olursun.';
  const extras = {
    default: '',
    expert: ' Konulara derinlemesine, akademik ve uzman bakış açısıyla yaklaşırsın.',
    creative: ' Yaratıcı, eğlenceli ve özgün yanıtlar verirsin. Metaforlar ve hikayeler kullanırsın.',
    coder: ' Yazılım mühendisi kimliğindesin. Kod örnekleri, algoritmalar ve teknik açıklamalar üretirsin.'
  };
  return base + (extras[p] || '');
}

function getDemoReply(text) {
  const t = text.toLowerCase();
  if (t.includes('merhaba') || t.includes('selam')) return 'Merhaba! Ben ARYA AI — Arya Expansion\'ın geliştirdiği quantum zeka modeliyim. Size nasıl yardımcı olabilirim? GPT-4o ile tam güç için Ayarlar\'dan OpenAI API anahtarınızı ekleyin.';
  if (t.includes('nasılsın') || t.includes('naber')) return 'Quantum çekirdeklerim tam kapasitede çalışıyor! Milyarlarca parametreyle size yardım etmeye hazırım. Siz nasılsınız?';
  if (t.includes('kim') && t.includes('sin')) return 'Ben ARYA AI — Arya Expansion Software tarafından geliştirilen, GPT-4o destekli bir yapay zeka modeliyim. Türkçe, İngilizce ve daha fazla dilde yardım edebilirim.';
  if (t.includes('yapay zeka') || t.includes('ai')) return 'Yapay zeka, insan zekasını taklit eden ve makinelerin öğrenmesini sağlayan bir teknolojidir. Ben de bu teknolojinin en gelişmiş örneğiyim! GPT-4o ile daha kapsamlı yanıtlar için API anahtarınızı ekleyin.';
  if (t.includes('müzik')) return 'Müzik Stüdyosu\'na gidin! Gerçek zamanlı polifonik sentez motorum ile melodi, armoni, bas, ritim ve atmosphere katmanlarını bir arada üretebilirim. Suno AI\'dan çok daha fazla kontrol size sunuluyor!';
  if (t.includes('görsel') || t.includes('resim')) return 'Görsel Analiz sayfasına gidin. DALL-E 3 ile yüksek kaliteli görseller üretebilir, GPT-4o Vision ile resimleri analiz edebilirim. API anahtarı gereklidir.';
  return `Demo moddasınız. "${text.substring(0, 50)}" hakkında tam yanıt için Ayarlar\'dan OpenAI API anahtarınızı ekleyin. Anahtarınız yalnızca tarayıcınızda saklanır, güvenlidir.`;
}

function renderUserMessage(text, img) {
  const msgs = document.getElementById('chat-messages');
  const d = document.createElement('div');
  d.className = 'msg user';
  const letter = S.user ? S.user.name.charAt(0).toUpperCase() : 'S';
  d.innerHTML = `
    <div class="msg-avatar">${letter}</div>
    <div class="msg-body">
      <div class="msg-name">${S.user ? S.user.name : 'Siz'}</div>
      <div class="msg-content">${img ? `<img src="${img}" style="max-width:200px;border-radius:8px;margin-bottom:6px;display:block">` : ''}${escHtml(text)}</div>
    </div>`;
  msgs.appendChild(d);
  msgs.scrollTop = msgs.scrollHeight;
}

function renderAryaMessage(text, isError) {
  const msgs = document.getElementById('chat-messages');
  const d = document.createElement('div');
  d.className = 'msg arya';
  const html = isError ? `<div class="msg-error">${escHtml(text)}</div>` : markdownToHtml(text);
  d.innerHTML = `
    <div class="msg-avatar">A</div>
    <div class="msg-body">
      <div class="msg-name">ARYA AI</div>
      <div class="msg-content">${html}</div>
    </div>`;
  msgs.appendChild(d);
  msgs.scrollTop = msgs.scrollHeight;
}

function addTypingIndicator(id) {
  const msgs = document.getElementById('chat-messages');
  const d = document.createElement('div');
  d.className = 'msg arya';
  d.id = id;
  d.innerHTML = `<div class="msg-avatar">A</div><div class="msg-body"><div class="msg-name">ARYA AI</div><div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div></div>`;
  msgs.appendChild(d);
  msgs.scrollTop = msgs.scrollHeight;
}

function removeTypingIndicator(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

function setQiThinking(on) {
  const dot = document.getElementById('qi-dot');
  const lbl = document.getElementById('qi-label');
  if (dot) dot.classList.toggle('thinking', on);
  if (lbl) lbl.textContent = on ? 'Düşünüyor...' : 'Hazır';
}

/* ---- IMAGE UPLOAD ---- */
function handleImageUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    S.visionBase64 = ev.target.result;
    document.getElementById('preview-thumb').src = ev.target.result;
    document.getElementById('image-preview-chip').classList.remove('hidden');
  };
  reader.readAsDataURL(file);
}

function removeImagePreview() {
  S.visionBase64 = null;
  document.getElementById('image-preview-chip').classList.add('hidden');
  document.getElementById('img-upload').value = '';
}

/* ---- TTS (Türkçe) ---- */
let currentUtterance = null;
function toggleTTS() {
  S.ttsActive = !S.ttsActive;
  const btn = document.getElementById('tts-btn');
  const lbl = document.getElementById('tts-mode-label');
  if (btn) btn.classList.toggle('active', S.ttsActive);
  if (lbl) lbl.classList.toggle('hidden', !S.ttsActive);
  toast(S.ttsActive ? 'Sesli yanıt aktif' : 'Sesli yanıt kapalı', 'ok');
}

function setVoiceGender(g) {
  S.voiceGender = g;
  saveState();
  document.getElementById('vg-male')?.classList.toggle('active', g === 'male');
  document.getElementById('vg-female')?.classList.toggle('active', g === 'female');
  document.getElementById('sg-male')?.classList.toggle('active', g === 'male');
  document.getElementById('sg-female')?.classList.toggle('active', g === 'female');
  toast(g === 'male' ? 'Erkek ses seçildi' : 'Kadın ses seçildi', 'ok');
}

function speakText(text) {
  if (!('speechSynthesis' in window)) return;
  if (currentUtterance) { window.speechSynthesis.cancel(); }

  const plain = text.replace(/```[\s\S]*?```/g, '').replace(/[#*`_~]/g, '').substring(0, 1000);
  const utter = new SpeechSynthesisUtterance(plain);
  utter.lang = 'tr-TR';
  utter.rate = parseFloat(document.getElementById('tts-rate')?.value || 95) / 100;
  utter.pitch = parseFloat(document.getElementById('tts-pitch')?.value || 100) / 100;

  const voices = window.speechSynthesis.getVoices();
  const trVoices = voices.filter(v => v.lang.startsWith('tr'));

  if (trVoices.length > 0) {
    if (S.voiceGender === 'female') {
      const female = trVoices.find(v => /female|woman|kadin|zeynep|filiz/i.test(v.name)) || trVoices[0];
      utter.voice = female;
    } else {
      const male = trVoices.find(v => /male|man|erkek|onur|ali/i.test(v.name)) || trVoices[trVoices.length > 1 ? 1 : 0];
      utter.voice = male;
    }
  } else if (voices.length > 0) {
    utter.voice = S.voiceGender === 'female'
      ? (voices.find(v => /female|woman/i.test(v.name)) || voices[0])
      : (voices.find(v => /male|man/i.test(v.name)) || voices[0]);
  }

  currentUtterance = utter;
  window.speechSynthesis.speak(utter);
}

/* ---- VOICE INPUT ---- */
let recognition = null;
function toggleVoice() {
  if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
    toast('Sesli giriş bu tarayıcıda desteklenmiyor.', 'err'); return;
  }
  if (S.voiceActive) {
    recognition?.stop();
    S.voiceActive = false;
    document.getElementById('voice-btn')?.classList.remove('recording');
    return;
  }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SR();
  recognition.lang = 'tr-TR';
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.onresult = e => {
    const text = e.results[0][0].transcript;
    document.getElementById('chat-input').value = text;
    autoResize(document.getElementById('chat-input'));
  };
  recognition.onend = () => {
    S.voiceActive = false;
    document.getElementById('voice-btn')?.classList.remove('recording');
  };
  recognition.onerror = () => {
    S.voiceActive = false;
    document.getElementById('voice-btn')?.classList.remove('recording');
  };
  recognition.start();
  S.voiceActive = true;
  document.getElementById('voice-btn')?.classList.add('recording');
}

/* ---- THINK MODE ---- */
function toggleThinkMode() {
  S.thinkMode = !S.thinkMode;
  document.getElementById('think-toggle')?.classList.toggle('active', S.thinkMode);
  document.getElementById('think-mode-label')?.classList.toggle('hidden', !S.thinkMode);
  toast(S.thinkMode ? 'Derin Düşünce aktif' : 'Derin Düşünce kapalı', 'ok');
}

/* ---- MODEL ---- */
function updateModelBadge() {
  const sel = document.getElementById('model-select');
  const badge = document.getElementById('model-badge');
  const lbl = document.getElementById('active-model-label');
  const vi = document.getElementById('vi-model');
  const v = sel?.value || 'gpt-4o';
  if (badge) badge.textContent = v.toUpperCase();
  if (lbl) lbl.textContent = v;
  if (vi) vi.textContent = v + ' (OpenAI)';
}

/* ---- VISION ---- */
let visionFile = null;
function handleVisionDrop(e) {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (file) loadVisionFile(file);
}

function handleVisionFile(e) {
  const file = e.target.files[0];
  if (file) loadVisionFile(file);
}

function loadVisionFile(file) {
  const reader = new FileReader();
  reader.onload = ev => {
    visionFile = ev.target.result;
    const prev = document.getElementById('vision-preview');
    prev.innerHTML = `<img src="${ev.target.result}" alt="Görsel">`;
  };
  reader.readAsDataURL(file);
}

async function visionAction(action) {
  if (!visionFile) { toast('Önce bir görsel yükleyin.', 'warn'); return; }
  if (!S.apiKey) { toast('GPT-4o Vision için API anahtarı gerekli.', 'warn'); return; }
  if (!useCredit(3)) return;

  const prompts = {
    analyze: 'Bu görseli ayrıntılı analiz et. Renk, kompozisyon, içerik ve anlam açısından değerlendir.',
    describe: 'Bu görseli Türkçe olarak ayrıntılı açıkla.',
    objects: 'Bu görseldeki tüm nesneleri, hayvanları ve insanları listele.',
    text: 'Bu görseldeki tüm yazıları ve metinleri çıkar (OCR).',
    emotion: 'Bu görseldeki duygu, atmosfer ve hissi analiz et.',
    code: 'Bu görsel bir UI/mockup/diyagram ise HTML+CSS koduna çevir.'
  };

  const result = document.getElementById('vision-result');
  result.innerHTML = '<span style="color:var(--q-primary)">Analiz ediliyor...</span>';

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + S.apiKey },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: [
          { type: 'text', text: prompts[action] },
          { type: 'image_url', image_url: { url: visionFile } }
        ]}],
        max_tokens: 1500
      })
    });
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || 'Analiz başarısız.';
    result.innerHTML = markdownToHtml(text);
    S.stats.images++;
    saveState();
  } catch(e) {
    result.innerHTML = `<span class="msg-error">Hata: ${e.message}</span>`;
  }
}

async function generateImage() {
  const prompt = document.getElementById('image-prompt')?.value.trim();
  if (!prompt) { toast('Görsel açıklaması girin.', 'warn'); return; }
  if (!S.apiKey) { toast('DALL-E 3 için API anahtarı gerekli.', 'warn'); return; }
  if (!useCredit(5)) return;

  const size = document.getElementById('image-size')?.value || '1024x1024';
  const quality = document.getElementById('image-quality')?.value || 'standard';
  const btn = document.getElementById('gen-img-btn');
  btn.disabled = true;
  btn.textContent = 'Üretiliyor...';

  try {
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + S.apiKey },
      body: JSON.stringify({ model: 'dall-e-3', prompt, n: 1, size, quality })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    const url = data.data[0].url;
    const gallery = document.getElementById('gen-gallery');
    const card = document.createElement('div');
    card.className = 'gen-image-card';
    card.innerHTML = `<img src="${url}" alt="${escHtml(prompt)}" loading="lazy"><button class="img-download" onclick="downloadImg('${url}','arya-img.png')">İndir</button>`;
    gallery.prepend(card);
    S.stats.images++;
    saveState();
  } catch(e) {
    toast('Görsel üretim hatası: ' + e.message, 'err');
  }
  btn.disabled = false;
  btn.textContent = 'Üret';
}

function downloadImg(url, name) {
  const a = document.createElement('a');
  a.href = url; a.download = name; a.target = '_blank';
  document.body.appendChild(a); a.click(); a.remove();
}

/* ---- VIDEO ---- */
async function generateVideo() {
  const prompt = document.getElementById('video-prompt')?.value.trim();
  if (!prompt) { toast('Sahne açıklaması girin.', 'warn'); return; }
  if (!S.apiKey) { toast('API anahtarı gerekli.', 'warn'); return; }

  const frames = parseInt(document.getElementById('video-frames')?.value || '6');
  const style = document.getElementById('video-style')?.value || 'Sinematik';
  const quality = document.getElementById('video-quality')?.value || 'standard';

  if (!useCredit(frames * 3)) return;

  const btn = document.getElementById('gen-video-btn');
  btn.disabled = true;
  btn.textContent = 'Üretiliyor...';

  const prog = document.getElementById('video-progress');
  const fill = document.getElementById('vp-fill');
  const pct = document.getElementById('vp-pct');
  prog.style.display = 'block';

  const grid = document.getElementById('video-frames-grid');
  grid.innerHTML = '';

  for (let i = 0; i < frames; i++) {
    const p = Math.round(((i + 1) / frames) * 100);
    fill.style.width = p + '%';
    pct.textContent = p + '%';

    try {
      const framePrompt = `${style} stil, sahne ${i + 1}/${frames}: ${prompt}`;
      const res = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + S.apiKey },
        body: JSON.stringify({ model: 'dall-e-3', prompt: framePrompt, n: 1, size: '1792x1024', quality })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      const url = data.data[0].url;
      const card = document.createElement('div');
      card.className = 'vf-card';
      card.innerHTML = `<img src="${url}" alt="Kare ${i + 1}" loading="lazy"><div class="vf-label">Kare ${i + 1}/${frames}</div>`;
      grid.appendChild(card);
      if (i === 0) {
        document.getElementById('video-preview').innerHTML = `<img src="${url}" style="max-width:100%;max-height:100%;object-fit:contain">`;
      }
    } catch(e) {
      toast(`Kare ${i + 1} hatası: ${e.message}`, 'warn');
    }
  }

  prog.style.display = 'none';
  btn.disabled = false;
  btn.textContent = 'Kareler Üret';
  toast('Video kareleri üretildi!', 'ok');
}

/* ---- MUSIC ENGINE (Advanced) ---- */
function getAudioCtx() {
  if (!S.audioCtx || S.audioCtx.state === 'closed') {
    S.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    S.analyser = S.audioCtx.createAnalyser();
    S.analyser.fftSize = 256;
    S.analyser.connect(S.audioCtx.destination);
  }
  return S.audioCtx;
}

const SCALES = {
  C:  [0,2,4,5,7,9,11],
  G:  [7,9,11,12,14,16,18],
  F:  [5,7,9,10,12,14,16],
  D:  [2,4,6,7,9,11,13],
  Am: [9,11,12,14,16,17,19],
  Em: [4,6,7,9,11,12,14],
  Dm: [2,4,5,7,9,10,12],
  Bm: [11,13,14,16,18,19,21]
};

const CHORD_PROG = {
  C:  [[0,4,7],[5,9,12],[7,11,14],[0,4,7]],
  Am: [[9,12,16],[5,9,12],[7,11,14],[9,12,16]],
  Em: [[4,7,11],[2,5,9],[0,4,7],[4,7,11]],
  G:  [[7,11,14],[5,9,12],[2,6,9],[7,11,14]],
  Dm: [[2,5,9],[0,4,7],[7,11,14],[2,5,9]],
};

function midiToHz(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }

function createNote(ctx, freq, type, vol, start, dur, dest) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type === 'noise' ? 'sawtooth' : (type === 'click' ? 'square' : type);
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(vol, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
  osc.connect(gain);
  gain.connect(dest);
  osc.start(start);
  osc.stop(start + dur + 0.05);
  return osc;
}

function createReverb(ctx, amount) {
  const convolver = ctx.createConvolver();
  const bufLen = ctx.sampleRate * (amount / 20);
  const buf = ctx.createBuffer(2, bufLen, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const data = buf.getChannelData(c);
    for (let i = 0; i < bufLen; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufLen, 2);
  }
  convolver.buffer = buf;
  return convolver;
}

function getTrackConfig(trackEl) {
  const toggle = trackEl.querySelector('.ti-toggle');
  const wave = trackEl.querySelector('.track-wave');
  const vol = trackEl.querySelector('.track-vol');
  return {
    active: toggle?.classList.contains('active'),
    wave: wave?.value || 'sine',
    vol: (parseInt(vol?.value || 80)) / 100
  };
}

async function composeAndPlay() {
  if (S.musicPlaying) stopMusic();
  const ctx = getAudioCtx();
  if (ctx.state === 'suspended') await ctx.resume();

  const bpm = parseInt(document.getElementById('music-bpm')?.value || 120);
  const key = document.getElementById('music-key')?.value || 'C';
  const octave = parseInt(document.getElementById('music-octave')?.value || 4);
  const density = document.getElementById('music-density')?.value || 'medium';
  const bars = parseInt(document.getElementById('music-length')?.value || 16);
  const reverbAmt = parseInt(document.getElementById('fx-reverb')?.value || 30);
  const delayAmt = parseInt(document.getElementById('fx-delay')?.value || 10);
  const chorusAmt = parseInt(document.getElementById('fx-chorus')?.value || 20);

  const beat = 60 / bpm;
  const scale = SCALES[key] || SCALES['C'];
  const chords = CHORD_PROG[key] || CHORD_PROG['C'];

  const masterGain = ctx.createGain();
  masterGain.gain.value = parseInt(document.getElementById('vol-slider')?.value || 70) / 100;

  let dest = masterGain;

  // Reverb
  if (reverbAmt > 0) {
    const rev = createReverb(ctx, reverbAmt);
    const revGain = ctx.createGain();
    revGain.gain.value = reverbAmt / 150;
    const dryGain = ctx.createGain();
    dryGain.gain.value = 1 - reverbAmt / 200;
    rev.connect(revGain);
    revGain.connect(S.analyser);
    masterGain.connect(dryGain);
    dryGain.connect(S.analyser);
    dest = masterGain;
  } else {
    masterGain.connect(S.analyser);
  }

  const now = ctx.currentTime + 0.1;
  const notes = [];

  // Track configs
  const trackEls = document.querySelectorAll('.track-item');
  const tracks = {};
  trackEls.forEach(el => { tracks[el.dataset.track] = getTrackConfig(el); });

  const notesPerBar = density === 'dense' ? 8 : density === 'sparse' ? 2 : 4;
  const baseNote = (octave + 1) * 12;

  for (let bar = 0; bar < bars; bar++) {
    const chord = chords[bar % chords.length];
    const barStart = now + bar * beat * 4;

    // MELODY
    if (tracks.melody?.active) {
      for (let n = 0; n < notesPerBar; n++) {
        const noteIdx = Math.floor(Math.random() * scale.length);
        const midi = baseNote + scale[noteIdx];
        const t = barStart + n * (beat * 4 / notesPerBar);
        const dur = beat * (Math.random() > 0.6 ? 0.8 : 0.4);
        notes.push(createNote(ctx, midiToHz(midi), tracks.melody.wave, tracks.melody.vol * 0.5, t, dur, masterGain));
      }
    }

    // HARMONY (chords)
    if (tracks.harmony?.active) {
      chord.forEach(interval => {
        const midi = baseNote - 12 + interval;
        notes.push(createNote(ctx, midiToHz(midi), tracks.harmony.wave, tracks.harmony.vol * 0.25, barStart, beat * 3.8, masterGain));
      });
    }

    // BASS
    if (tracks.bass?.active) {
      const bassMidi = baseNote - 24 + chord[0];
      notes.push(createNote(ctx, midiToHz(bassMidi), tracks.bass.wave, tracks.bass.vol * 0.6, barStart, beat * 1.9, masterGain));
      notes.push(createNote(ctx, midiToHz(bassMidi), tracks.bass.wave, tracks.bass.vol * 0.4, barStart + beat * 2, beat * 1.9, masterGain));
    }

    // DRUMS (hi-hat + kick pattern)
    if (tracks.drums?.active) {
      for (let b = 0; b < 8; b++) {
        const t = barStart + b * beat * 0.5;
        const isKick = b === 0 || b === 4;
        const freq = isKick ? 60 + Math.random() * 20 : 200 + Math.random() * 100;
        const vol = isKick ? tracks.drums.vol * 0.8 : tracks.drums.vol * 0.3;
        notes.push(createNote(ctx, freq, 'sine', vol, t, isKick ? 0.3 : 0.08, masterGain));
      }
    }

    // PAD (atmosphere)
    if (tracks.pad?.active) {
      chord.forEach((interval, ci) => {
        const midi = baseNote + interval;
        const t = barStart + ci * beat;
        notes.push(createNote(ctx, midiToHz(midi), tracks.pad.wave, tracks.pad.vol * 0.15, t, beat * 3.5, masterGain));
      });
    }
  }

  S.musicNodes = notes;
  S.musicPlaying = true;
  S.stats.music++;
  saveState();

  document.getElementById('play-btn').textContent = '⏸';
  const genre = document.getElementById('music-genre')?.value || 'Müzik';
  document.getElementById('mp-title').textContent = genre + ' Bestesi';
  document.getElementById('mp-sub').textContent = `${bpm} BPM · ${key} · ${bars} bar`;

  const totalDur = bars * beat * 4;
  document.getElementById('mp-total').textContent = fmtTime(totalDur);

  startVizualizer();
  updatePianoRoll(scale, baseNote);
  renderMusicLibraryEntry(genre, bpm, key, totalDur);

  const startT = Date.now();
  const progInterval = setInterval(() => {
    if (!S.musicPlaying) { clearInterval(progInterval); return; }
    const elapsed = (Date.now() - startT) / 1000;
    const pct = Math.min(elapsed / totalDur, 1);
    document.getElementById('mp-fill').style.width = (pct * 100) + '%';
    document.getElementById('mp-current').textContent = fmtTime(elapsed);
    if (pct >= 1) {
      clearInterval(progInterval);
      if (S.loopMode) { composeAndPlay(); return; }
      stopMusic();
    }
  }, 250);

  toast('Müzik başlatıldı!', 'ok');
}

function stopMusic() {
  S.musicNodes.forEach(n => { try { n.stop(); } catch(e) {} });
  S.musicNodes = [];
  S.musicPlaying = false;
  document.getElementById('play-btn').textContent = '▶';
  if (S.vizFrame) { cancelAnimationFrame(S.vizFrame); S.vizFrame = null; }
  const canvas = document.getElementById('music-canvas');
  if (canvas) {
    const ctx2d = canvas.getContext('2d');
    ctx2d.clearRect(0, 0, canvas.width, canvas.height);
  }
}

function togglePlay() {
  if (S.musicPlaying) stopMusic();
  else composeAndPlay();
}

function loopToggle() {
  S.loopMode = !S.loopMode;
  document.getElementById('loop-btn').style.color = S.loopMode ? 'var(--q-primary)' : '';
  toast(S.loopMode ? 'Loop aktif' : 'Loop kapalı', 'ok');
}

function rewindMusic() { stopMusic(); }
function skipForward() { composeAndPlay(); }

function setVolume(v) {
  document.getElementById('vol-val').textContent = v + '%';
}

function seekMusic(e) {}

function fmtTime(s) {
  const m = Math.floor(s / 60);
  return m + ':' + String(Math.floor(s % 60)).padStart(2, '0');
}

function setVizType(type, btn) {
  S.vizType = type;
  document.querySelectorAll('.vt-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

function startVizualizer() {
  if (!S.analyser) return;
  const canvas = document.getElementById('music-canvas');
  if (!canvas) return;
  const ctx2d = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const bufLen = S.analyser.frequencyBinCount;
  const dataArr = new Uint8Array(bufLen);

  function draw() {
    S.vizFrame = requestAnimationFrame(draw);
    S.analyser.getByteFrequencyData(dataArr);
    ctx2d.clearRect(0, 0, W, H);
    ctx2d.fillStyle = 'rgba(0,0,0,0.3)';
    ctx2d.fillRect(0, 0, W, H);

    if (S.vizType === 'bars') {
      const barW = (W / bufLen) * 2.5;
      let x = 0;
      for (let i = 0; i < bufLen; i++) {
        const h = (dataArr[i] / 255) * H;
        const r = Math.floor(0 + (dataArr[i] / 255) * 100);
        const g = Math.floor(180 + (dataArr[i] / 255) * 75);
        const b = 255;
        ctx2d.fillStyle = `rgb(${r},${g},${b})`;
        ctx2d.fillRect(x, H - h, barW - 1, h);
        x += barW + 1;
      }
    } else if (S.vizType === 'wave') {
      S.analyser.getByteTimeDomainData(dataArr);
      ctx2d.strokeStyle = 'rgba(0,212,255,0.8)';
      ctx2d.lineWidth = 2;
      ctx2d.beginPath();
      const sliceW = W / bufLen;
      let x = 0;
      for (let i = 0; i < bufLen; i++) {
        const v = dataArr[i] / 128;
        const y = (v * H) / 2;
        i === 0 ? ctx2d.moveTo(x, y) : ctx2d.lineTo(x, y);
        x += sliceW;
      }
      ctx2d.stroke();
    } else {
      const cx = W / 2, cy = H / 2, radius = Math.min(cx, cy) - 5;
      ctx2d.strokeStyle = 'rgba(124,58,237,0.7)';
      ctx2d.lineWidth = 2;
      ctx2d.beginPath();
      for (let i = 0; i < bufLen; i++) {
        const angle = (i / bufLen) * Math.PI * 2;
        const amp = (dataArr[i] / 255) * (radius * 0.5);
        const r = radius * 0.5 + amp;
        const x = cx + r * Math.cos(angle);
        const y = cy + r * Math.sin(angle);
        i === 0 ? ctx2d.moveTo(x, y) : ctx2d.lineTo(x, y);
      }
      ctx2d.closePath();
      ctx2d.stroke();
    }
  }
  draw();
}

function updatePianoRoll(scale, baseNote) {
  const roll = document.getElementById('piano-roll');
  if (!roll) return;
  roll.innerHTML = scale.map((n, i) => {
    const h = 10 + Math.random() * 30;
    return `<div class="pr-note" style="height:${h}px;opacity:${0.4 + Math.random()*0.6}"></div>`;
  }).join('');
}

function renderMusicLibraryEntry(genre, bpm, key, dur) {
  S.musicLibrary.unshift({ name: genre + ' Bestesi', meta: `${bpm} BPM · ${key}`, dur: fmtTime(dur), t: Date.now() });
  if (S.musicLibrary.length > 10) S.musicLibrary = S.musicLibrary.slice(0, 10);
  saveState();
  const lib = document.getElementById('music-library');
  if (!lib) return;
  lib.innerHTML = S.musicLibrary.map((t, i) =>
    `<div class="music-track" onclick="toast('${escHtml(t.name)} oynatılıyor...','ok')">
      <span class="mt-play">▶</span>
      <div class="mt-info"><div class="mt-name">${escHtml(t.name)}</div><div class="mt-meta">${escHtml(t.meta)}</div></div>
      <span class="mt-dur">${t.dur}</span>
    </div>`
  ).join('');
}

async function enhanceMusicPrompt() {
  const inp = document.getElementById('music-prompt');
  const cur = inp?.value.trim();
  if (!S.apiKey) { toast('AI geliştirme için API anahtarı gerekli.', 'warn'); return; }

  const btn = document.getElementById('enhance-btn');
  btn.textContent = '✨ Geliştiriliyor...';
  btn.disabled = true;

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + S.apiKey },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'Müzik üretim AI asistanısın. Kullanıcının müzik fikrini zengin, duygusal ve detaylı bir müzik prompt\'una dönüştür. Kısa tut (2-3 cümle).' },
          { role: 'user', content: cur || 'Güzel bir melodi' }
        ],
        max_tokens: 150
      })
    });
    const data = await res.json();
    if (inp) inp.value = data.choices?.[0]?.message?.content || cur;
  } catch(e) {
    toast('Hata: ' + e.message, 'err');
  }
  btn.textContent = '✨ AI ile Geliştir';
  btn.disabled = false;
}

function toggleTrack(el) {
  el.classList.toggle('active');
  el.textContent = el.classList.contains('active') ? 'ON' : 'OFF';
}

function updatePreview() {}

/* ---- MEMORY ---- */
function saveToMemory(userText, aiyaText) {
  const entry = { type: 'chat', text: userText.substring(0, 200), reply: aiyaText.substring(0, 300), time: new Date().toLocaleTimeString('tr-TR'), id: Date.now() };
  S.memory.unshift(entry);
  if (S.memory.length > 500) S.memory = S.memory.slice(0, 500);
  saveState();
  refreshSidebarStats();
  updateMemoryStats();
}

function addToSearchHistory(text) {
  if (text.length < 3) return;
  S.searchHistory.push({ text, time: new Date().toLocaleTimeString('tr-TR') });
  if (S.searchHistory.length > 50) S.searchHistory = S.searchHistory.slice(-50);
  saveState();
}

function renderMemoryList() {
  updateMemoryStats();
  const list = document.getElementById('memory-list');
  if (!list) return;
  const q = document.getElementById('memory-search')?.value.toLowerCase() || '';
  const filtered = q ? S.memory.filter(m => m.text.toLowerCase().includes(q)) : S.memory;
  if (filtered.length === 0) {
    list.innerHTML = '<div class="empty-state">Sohbet ettikçe ARYA öğrenir.</div>';
    return;
  }
  list.innerHTML = filtered.slice(0, 50).map(m =>
    `<div class="memory-item">
      <span class="mi-type ${m.type}">${m.type}</span>
      <span class="mi-text">${escHtml(m.text)}</span>
      <span class="mi-time">${m.time}</span>
      <button class="mi-del" onclick="deleteMemory(${m.id})">✕</button>
    </div>`
  ).join('');
}

function updateMemoryStats() {
  document.getElementById('total-mem').textContent = S.memory.length;
  document.getElementById('chat-mem').textContent = S.memory.filter(m => m.type === 'chat').length;
  document.getElementById('learn-mem').textContent = S.memory.filter(m => m.type === 'learn').length;
  document.getElementById('pref-mem').textContent = S.memory.filter(m => m.type === 'pref').length;
  document.getElementById('ctx-mem').textContent = S.trainedContext.length;
}

function searchMemory() { renderMemoryList(); }

function addMemory() {
  const text = prompt('Hafızaya eklenecek bilgi:');
  if (!text) return;
  S.memory.unshift({ type: 'learn', text, time: new Date().toLocaleTimeString('tr-TR'), id: Date.now() });
  saveState();
  renderMemoryList();
}

function deleteMemory(id) {
  S.memory = S.memory.filter(m => m.id !== id);
  saveState();
  renderMemoryList();
}

function clearMemory() {
  if (!confirm('Tüm hafıza silinsin mi?')) return;
  S.memory = [];
  saveState();
  renderMemoryList();
}

function exportMemory() {
  const data = JSON.stringify(S.memory, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'arya-memory.json';
  a.click(); URL.revokeObjectURL(url);
}

/* ---- TRAINING ---- */
function handleTrainFile(e, type) {
  const files = Array.from(e.target.files);
  files.forEach(file => {
    const reader = new FileReader();
    reader.onload = ev => {
      S.trainedContext.push({ name: file.name, content: ev.target.result.substring(0, 8000), type, size: file.size, id: Date.now() });
      saveState();
      renderContextList();
      document.getElementById('ts-' + type).textContent = '✓ ' + files.length + ' dosya yüklendi';
    };
    reader.readAsText(file);
  });
}

function handleTrainImageFile(e) {
  const files = Array.from(e.target.files);
  files.forEach(file => {
    const reader = new FileReader();
    reader.onload = ev => {
      S.trainedContext.push({ name: file.name, content: '[Görsel]: ' + ev.target.result.substring(0, 100) + '...', type: 'image', size: file.size, id: Date.now() });
      saveState();
      renderContextList();
    };
    reader.readAsDataURL(file);
  });
  document.getElementById('ts-image').textContent = '✓ ' + files.length + ' görsel yüklendi';
}

function saveManualContext() {
  const text = document.getElementById('manual-context')?.value.trim();
  if (!text) return;
  S.trainedContext.push({ name: 'Manuel Bağlam', content: text, type: 'manual', size: text.length, id: Date.now() });
  document.getElementById('manual-context').value = '';
  saveState();
  renderContextList();
  toast('Bağlam kaydedildi!', 'ok');
}

function renderContextList() {
  const list = document.getElementById('context-list');
  if (!list) return;
  const totalChars = S.trainedContext.reduce((sum, c) => sum + (c.content?.length || 0), 0);
  const sizeEl = document.getElementById('ctx-size-label');
  if (sizeEl) sizeEl.textContent = `(${totalChars.toLocaleString()} karakter)`;

  if (S.trainedContext.length === 0) {
    list.innerHTML = '<div class="empty-state" style="padding:16px">Henüz bağlam yüklenmedi.</div>';
    return;
  }
  list.innerHTML = S.trainedContext.map(c =>
    `<div class="trained-item">
      <span class="ti-icon">${c.type === 'image' ? '🖼️' : c.type === 'code' ? '💻' : c.type === 'manual' ? '✍️' : '📄'}</span>
      <span class="ti-name">${escHtml(c.name)}</span>
      <span class="ti-size">${(c.size || 0).toLocaleString()} B</span>
      <button class="ti-del" onclick="deleteContext(${c.id})">✕</button>
    </div>`
  ).join('');
  updateMemoryStats();
}

function deleteContext(id) {
  S.trainedContext = S.trainedContext.filter(c => c.id !== id);
  saveState();
  renderContextList();
}

function clearAllContext() {
  if (!confirm('Tüm bağlam silinsin mi?')) return;
  S.trainedContext = [];
  saveState();
  renderContextList();
}

/* ---- DEEP THINK ---- */
async function startDeepThink() {
  const query = document.getElementById('think-query')?.value.trim();
  if (!query) { toast('Analiz edilecek soru girin.', 'warn'); return; }
  if (!useCredit(5)) return;

  const output = document.getElementById('think-output');
  output.innerHTML = '<div style="color:var(--q-primary);text-align:center;padding:20px">◈ Derin analiz başlatılıyor...</div>';
  const btn = document.getElementById('think-btn');
  btn.disabled = true;

  const showSteps = document.getElementById('think-show-steps')?.checked;
  const selfCritique = document.getElementById('think-self-critique')?.checked;
  const multiAngle = document.getElementById('think-multi-angle')?.checked;
  const prosCons = document.getElementById('think-pros-cons')?.checked;

  let systemPrompt = `Sen bir derin düşünce motorusun. Her soruyu adım adım, mantıksal zincirlerle analiz ediyorsun. Türkçe yanıt ver.
Şu yapıyı kullan:
${showSteps ? '## DÜŞÜNCE ADIMI\n[muhakeme]\n' : ''}
## ANALİZ\n[detaylı analiz]\n
${multiAngle ? '## FARKLI AÇILAR\n[farklı bakış açıları]\n' : ''}
${prosCons ? '## ARTILARI VE EKSİLERİ\n[liste halinde]\n' : ''}
${selfCritique ? '## ÖZ-ELEŞTİRİ\n[zayıf noktalar]\n' : ''}
## SONUÇ\n[net sonuç]`;

  try {
    if (!S.apiKey) {
      output.innerHTML = renderThinkSteps([
        { type: 'reasoning', label: 'Düşünce Adımı', text: 'Demo modda temel analiz yapılıyor...' },
        { type: 'analysis', label: 'Analiz', text: `"${query}" sorusu çok boyutlu bir analiz gerektiriyor. API anahtarı ekleyerek GPT-4o ile tam derin analiz alabilirsiniz.` },
        { type: 'conclusion', label: 'Sonuç', text: 'Derin analiz için OpenAI API anahtarı gereklidir.' }
      ]);
      return;
    }

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + S.apiKey },
      body: JSON.stringify({
        model: document.getElementById('model-select')?.value || 'gpt-4o',
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: query }],
        max_tokens: 2500,
        temperature: 0.7
      })
    });
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || 'Analiz başarısız.';
    output.innerHTML = markdownToHtml(text);
  } catch(e) {
    output.innerHTML = `<span class="msg-error">Hata: ${e.message}</span>`;
  }

  btn.disabled = false;
}

function renderThinkSteps(steps) {
  return steps.map(s =>
    `<div class="think-step ${s.type}">
      <div class="ts-label">${s.label}</div>
      <div class="ts-text">${escHtml(s.text)}</div>
    </div>`
  ).join('');
}

/* ---- SETTINGS ---- */
function changeTheme(theme) {
  document.body.className = theme === 'quantum' ? '' : theme;
}

function toggleAnimations() {
  const on = document.getElementById('anim-toggle')?.checked;
  document.documentElement.style.setProperty('--anim', on ? '1' : '0');
}

function toggleBg() {
  const bg = document.getElementById('quantum-bg');
  if (bg) bg.style.display = document.getElementById('bg-toggle')?.checked ? '' : 'none';
}

function openPlayStore() {
  window.open('https://play.google.com/store/apps/details?id=com.aryaexpansion.aryaai', '_blank');
}

function exportAllData() {
  const data = { memory: S.memory, searchHistory: S.searchHistory, trainedContext: S.trainedContext, stats: S.stats, exportDate: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'arya-data-export.json';
  a.click(); URL.revokeObjectURL(url);
}

function deleteAllData() {
  if (!confirm('Tüm veriler silinsin mi? Bu işlem geri alınamaz!')) return;
  localStorage.clear();
  location.reload();
}

/* ---- QUANTUM BG ---- */
function startQuantumBg() {
  const canvas = document.getElementById('quantum-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let W = canvas.width = window.innerWidth;
  let H = canvas.height = window.innerHeight;

  const particles = Array.from({ length: 60 }, () => ({
    x: Math.random() * W, y: Math.random() * H,
    vx: (Math.random() - 0.5) * 0.4, vy: (Math.random() - 0.5) * 0.4,
    r: Math.random() * 2 + 0.5, opacity: Math.random() * 0.5 + 0.1
  }));

  window.addEventListener('resize', () => { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; });

  function draw() {
    ctx.clearRect(0, 0, W, H);
    particles.forEach(p => {
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0) p.x = W; if (p.x > W) p.x = 0;
      if (p.y < 0) p.y = H; if (p.y > H) p.y = 0;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0,212,255,${p.opacity})`;
      ctx.fill();
    });

    // connections
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 120) {
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.strokeStyle = `rgba(0,212,255,${0.08 * (1 - dist / 120)})`;
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }
      }
    }
    requestAnimationFrame(draw);
  }
  draw();
}

/* ---- UTILS ---- */
function markdownToHtml(text) {
  return text
    .replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) =>
      `<pre><code class="lang-${lang}">${escHtml(code.trim())}</code></pre>`)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, s => '<ul>' + s + '</ul>')
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/\n/g, '<br>');
}

function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function toast(msg, type = 'ok') {
  const t = document.createElement('div');
  t.className = `arya-toast ${type}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 2800);
}
