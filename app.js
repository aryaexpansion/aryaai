'use strict';

// ══════════════════════════════════════════
//  ARYA AI — app.js v2.0  Full Active Engine
// ══════════════════════════════════════════

// ── CONFIG ────────────────────────────────
const CFG = {
  openaiBase: 'https://api.openai.com/v1',
  defaultModel: 'gpt-4o',
  maxMemory: 300,
  maxContext: 8000,
};

const PERSONALITIES = {
  default:  'Sen ARYA AI\'sın. Dünyanın en gelişmiş Quantum Zeka Modelisin. Türkçe konuşursun, zeki, yardımsever ve yaratıcısın.',
  expert:   'Sen bir uzman asistansın. Her konuda derin teknik bilgiye sahipsin. Kesin, veri odaklı ve kapsamlı yanıtlar verirsin.',
  creative: 'Sen yaratıcı bir yazarsın. Şiir, hikaye, senaryo yazma konusunda üstün yeteneklere sahipsin. Duygusal ve edebi bir dil kullanırsın.',
  coder:    'Sen bir kıdemli yazılım mühendisisin. Temiz, optimize edilmiş, yorum satırlı kod yazarsın. Her dili ve framework\'ü bilirsin.',
  teacher:  'Sen sabırlı ve açıklayıcı bir öğretmensin. Karmaşık konuları basit örneklerle, adım adım açıklarsın.',
};

// ── STATE ─────────────────────────────────
const S = {
  apiKey: localStorage.getItem('arya_api_key') || '',
  memory: JSON.parse(localStorage.getItem('arya_memory') || '[]'),
  context: JSON.parse(localStorage.getItem('arya_context') || '[]'),
  chatHistory: [],
  pendingImage: null,
  thinkMode: false,
  ttsEnabled: false,
  isStreaming: false,
  musicEngine: null,
  musicNodes: [],
  isPlaying: false,
  vizInterval: null,
  ttsVoices: [],
  visionImageData: null,
  musicTracks: [],
  currentTrack: -1,
};

// ── QUANTUM CANVAS ────────────────────────
(function initCanvas() {
  const canvas = document.getElementById('quantum-canvas');
  const ctx = canvas.getContext('2d');
  let W, H, particles = [];
  const N = 70;
  function resize() { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; }
  window.addEventListener('resize', resize); resize();
  function mkP() { return { x: Math.random()*W, y: Math.random()*H, vx:(Math.random()-.5)*.4, vy:(Math.random()-.5)*.4, r:Math.random()*1.5+.5, a:Math.random()*.4+.1 }; }
  for (let i=0;i<N;i++) particles.push(mkP());
  function frame() {
    ctx.clearRect(0,0,W,H);
    for (let i=0;i<N;i++) for (let j=i+1;j<N;j++) {
      const dx=particles[i].x-particles[j].x, dy=particles[i].y-particles[j].y, d=Math.sqrt(dx*dx+dy*dy);
      if (d<130) { ctx.beginPath(); ctx.strokeStyle=`rgba(0,212,255,${.14*(1-d/130)})`; ctx.lineWidth=.5; ctx.moveTo(particles[i].x,particles[i].y); ctx.lineTo(particles[j].x,particles[j].y); ctx.stroke(); }
    }
    particles.forEach(p => {
      p.x+=p.vx; p.y+=p.vy;
      if(p.x<0||p.x>W) p.vx*=-1; if(p.y<0||p.y>H) p.vy*=-1;
      const g=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,p.r*3);
      g.addColorStop(0,`rgba(0,212,255,${p.a})`); g.addColorStop(1,'transparent');
      ctx.beginPath(); ctx.fillStyle=g; ctx.arc(p.x,p.y,p.r*3,0,Math.PI*2); ctx.fill();
    });
    requestAnimationFrame(frame);
  }
  frame();
})();

// ── SPLASH ────────────────────────────────
(function initSplash() {
  const msgs = ['Quantum çekirdek başlatılıyor...','Sinir ağları yükleniyor...','OpenAI motoru bağlanıyor...','Web Audio API hazır...','Hafıza sistemi başlatılıyor...','ARYA AI hazır!'];
  let i=0; const el=document.getElementById('splash-status');
  const iv=setInterval(()=>{ if(i<msgs.length) el.textContent=msgs[i++]; else clearInterval(iv); },380);
  setTimeout(()=>{
    document.getElementById('splash').classList.add('fade-out');
    setTimeout(()=>{
      document.getElementById('splash').style.display='none';
      document.getElementById('app').classList.remove('hidden');
      initApp();
    },800);
  },2600);
})();

// ── INIT ─────────────────────────────────
function initApp() {
  updateApiStatus();
  updateMemoryUI();
  initTTSVoices();
  initVizBars();
  if (!S.apiKey) {
    setTimeout(()=> document.getElementById('api-modal').classList.remove('hidden'), 400);
  }
  document.addEventListener('click', e => {
    if (window.innerWidth<=900) {
      const sb=document.getElementById('sidebar'), tg=document.getElementById('sidebar-toggle');
      if (sb.classList.contains('open') && !sb.contains(e.target) && !tg.contains(e.target)) sb.classList.remove('open');
    }
  });
  const saved = localStorage.getItem('arya_api_key');
  if (saved) document.getElementById('openai-key').value = saved;
  updateContextUI();
}

function updateApiStatus() {
  const has = !!S.apiKey;
  document.getElementById('api-stat').textContent = has ? 'Aktif' : 'Demo';
  document.getElementById('api-stat').style.color = has ? 'var(--success)' : 'var(--warning)';
  document.getElementById('user-plan').textContent = has ? 'Quantum Pro' : 'Demo Plan';
  document.getElementById('api-key-status').textContent = has ? '✓ Yapılandırıldı' : 'Yapılandırılmadı';
  document.getElementById('api-key-status').style.color = has ? 'var(--success)' : 'var(--text-muted)';
  if (!has) document.getElementById('api-banner').classList.remove('hidden');
  else document.getElementById('api-banner').classList.add('hidden');
}

// ── API KEY MANAGEMENT ────────────────────
function validateKeyInput() {
  const val = document.getElementById('modal-api-key').value.trim();
  const st = document.getElementById('modal-key-status');
  if (val.startsWith('sk-')) { st.textContent='✓ Geçerli format'; st.style.color='var(--success)'; }
  else if (val.length>4) { st.textContent='sk- ile başlamalı'; st.style.color='var(--warning)'; }
  else st.textContent='';
}

function saveApiKeyFromModal() {
  const key = document.getElementById('modal-api-key').value.trim();
  if (!key) return;
  S.apiKey = key;
  localStorage.setItem('arya_api_key', key);
  document.getElementById('openai-key').value = key;
  document.getElementById('api-modal').classList.add('hidden');
  updateApiStatus();
  showToast('API anahtarı kaydedildi! Tüm özellikler aktif.');
}

function dismissModal() {
  document.getElementById('api-modal').classList.add('hidden');
}

function saveApiKey() {
  const key = document.getElementById('openai-key').value.trim();
  if (!key) { showToast('Lütfen API anahtarı girin.','warn'); return; }
  S.apiKey = key;
  localStorage.setItem('arya_api_key', key);
  updateApiStatus();
  showToast('API anahtarı kaydedildi!');
}

// ── OPENAI API CLIENT ─────────────────────
async function openaiChat(messages, model, stream=true, onChunk=null) {
  if (!S.apiKey) throw new Error('API anahtarı yok');
  const body = { model, messages, stream, temperature: getTemp() };
  const res = await fetch(`${CFG.openaiBase}/chat/completions`, {
    method:'POST',
    headers:{ 'Content-Type':'application/json', 'Authorization':`Bearer ${S.apiKey}` },
    body: JSON.stringify(body)
  });
  if (!res.ok) { const e=await res.json(); throw new Error(e.error?.message || `HTTP ${res.status}`); }
  if (!stream) { const d=await res.json(); return d.choices[0].message.content; }
  const reader = res.body.getReader(), dec = new TextDecoder();
  let full='';
  while (true) {
    const {done,value}=await reader.read(); if(done) break;
    const lines=dec.decode(value).split('\n').filter(l=>l.startsWith('data: '));
    for (const line of lines) {
      const data=line.slice(6); if(data==='[DONE]') continue;
      try { const j=JSON.parse(data); const delta=j.choices[0]?.delta?.content||''; if(delta){ full+=delta; if(onChunk) onChunk(delta); } } catch{}
    }
  }
  return full;
}

async function openaiVision(imageBase64, prompt, model='gpt-4o') {
  if (!S.apiKey) throw new Error('API anahtarı yok');
  const body = { model, messages:[{role:'user',content:[{type:'text',text:prompt},{type:'image_url',image_url:{url:imageBase64,detail:'high'}}]}], max_tokens:1000 };
  const res = await fetch(`${CFG.openaiBase}/chat/completions`,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${S.apiKey}`},body:JSON.stringify(body)});
  if (!res.ok) { const e=await res.json(); throw new Error(e.error?.message); }
  const d=await res.json(); return d.choices[0].message.content;
}

async function openaiDalle(prompt, size='1024x1024', quality='standard') {
  if (!S.apiKey) throw new Error('API anahtarı yok');
  const body = { model:'dall-e-3', prompt, n:1, size, quality, response_format:'url' };
  const res = await fetch(`${CFG.openaiBase}/images/generations`,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${S.apiKey}`},body:JSON.stringify(body)});
  if (!res.ok) { const e=await res.json(); throw new Error(e.error?.message); }
  const d=await res.json(); return d.data[0].url;
}

function getTemp() {
  const r=document.getElementById('temp-range'); return r ? parseFloat((r.value/100).toFixed(1)) : 0.7;
}

function getSystemPrompt() {
  const p=document.getElementById('personality-select')?.value||'default';
  let sys = PERSONALITIES[p];
  if (S.context.length>0) {
    const ctx=S.context.map(c=>c.content).join('\n\n');
    sys += `\n\n--- KULLANICI BAĞLAMI ---\n${ctx.slice(0,CFG.maxContext)}\n--- /BAĞLAM ---`;
  }
  return sys;
}

// ── NAVIGATION ────────────────────────────
const PAGE_TITLES = { chat:'Quantum Chat', vision:'Görsel Analiz & Üretim', video:'Video Üretim Stüdyosu', music:'Müzik Stüdyosu', memory:'Hafıza Merkezi', train:'AI Eğitim Merkezi', think:'Derin Düşünce Motoru', settings:'Ayarlar' };

function showPage(id) {
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  document.getElementById('page-'+id)?.classList.add('active');
  document.querySelector(`.nav-item[data-page="${id}"]`)?.classList.add('active');
  document.getElementById('page-title').textContent=PAGE_TITLES[id]||id;
  if(window.innerWidth<=900) document.getElementById('sidebar').classList.remove('open');
  if(id==='memory') updateMemoryUI();
  if(id==='train') updateContextUI();
}
function toggleSidebar(){ document.getElementById('sidebar').classList.toggle('open'); }

// ── CHAT ─────────────────────────────────
function handleKey(e){ if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage();} }
function autoResize(el){ el.style.height='auto'; el.style.height=Math.min(el.scrollHeight,200)+'px'; }
function fillInput(t){ const i=document.getElementById('chat-input'); i.value=t; i.focus(); autoResize(i); }

function updateModelBadge(){
  const m=document.getElementById('model-select').value;
  document.getElementById('model-badge').textContent=m;
  document.getElementById('active-model-label').textContent=m;
  document.getElementById('vi-model').textContent=m+' (OpenAI)';
}

function toggleThinkMode(){
  S.thinkMode=!S.thinkMode;
  document.getElementById('think-toggle').classList.toggle('active',S.thinkMode);
  document.getElementById('think-mode-label').classList.toggle('hidden',!S.thinkMode);
}

function toggleTTS(){
  S.ttsEnabled=!S.ttsEnabled;
  document.getElementById('tts-btn').classList.toggle('active',S.ttsEnabled);
  document.getElementById('tts-mode-label').classList.toggle('hidden',!S.ttsEnabled);
}

function newChat(){ document.getElementById('chat-messages').innerHTML=''; S.chatHistory=[]; document.getElementById('chat-messages').appendChild(buildWelcomeCard()); }
function clearCurrentPage(){ const id=document.querySelector('.page.active')?.id?.replace('page-',''); if(id==='chat') newChat(); }

function buildWelcomeCard(){
  const d=document.createElement('div'); d.id='welcome-card'; d.className='welcome-card';
  d.innerHTML=`<div class="wc-rings"><div class="wc-ring wcr1"></div><div class="wc-ring wcr2"></div><div class="wc-ring wcr3"></div></div>
  <h2 class="wc-title">ARYA AI'ya Hoş Geldiniz</h2>
  <p class="wc-sub">GPT-4o destekli Quantum Zeka Modeli. Düşünür, görür, duyar ve üretir.</p>
  <div class="wc-caps">
    <div class="cap"><span class="cap-icon">◈</span>GPT-4o Streaming</div>
    <div class="cap"><span class="cap-icon">◈</span>DALL-E 3 Görsel</div>
    <div class="cap"><span class="cap-icon">◈</span>Vision Analizi</div>
    <div class="cap"><span class="cap-icon">◈</span>Sesli Yanıt</div>
  </div>
  <div class="wc-suggestions">
    <button class="suggestion-btn" onclick="fillInput('Kuantum hesaplama nedir ve geleceği nasıl şekillendirecek?')">Kuantum hesaplama</button>
    <button class="suggestion-btn" onclick="fillInput('Python ile neural network yaz.')">Neural network yaz</button>
    <button class="suggestion-btn" onclick="fillInput('Bana kısa bir şiir yaz.')">Şiir yaz</button>
    <button class="suggestion-btn" onclick="fillInput('Yapay zekanın geleceğini anlat.')">AI'nin geleceği</button>
  </div>`;
  return d;
}

async function sendMessage() {
  if (S.isStreaming) return;
  const inp=document.getElementById('chat-input');
  const text=inp.value.trim();
  if (!text && !S.pendingImage) return;

  inp.value=''; inp.style.height='auto';
  document.getElementById('welcome-card')?.remove();

  const hasImg=!!S.pendingImage;
  const imgData=S.pendingImage;
  if(hasImg){ removeImagePreview(); }

  // User message
  const userContent = hasImg
    ? `<img src="${imgData}" style="max-width:100%;border-radius:8px;display:block;margin-bottom:8px">${escHtml(text)}`
    : renderMarkdown(text);
  appendMsg('user', userContent, 'Siz');

  saveMemory({type:'chat', text:text.slice(0,100)});
  setThinking(true);

  // Build messages
  const msgs=[{role:'system',content:getSystemPrompt()}];
  S.chatHistory.slice(-10).forEach(m=>msgs.push(m));
  if(hasImg){
    msgs.push({role:'user',content:[{type:'text',text:text||'Bu görseli analiz et.'},{type:'image_url',image_url:{url:imgData,detail:'high'}}]});
  } else {
    msgs.push({role:'user',content:text});
  }

  // Think mode: show reasoning
  if(S.thinkMode && S.apiKey){
    const thinkEl=appendThinkBubble('Derin analiz yapılıyor...');
    try{
      const reasonResp=await openaiChat([{role:'system',content:'Sadece kısa bir düşünce süreci yaz, kesin yanıt verme.'},{role:'user',content:`Bu konuyu adım adım düşün: ${text}`}],
        document.getElementById('model-select').value,false);
      thinkEl.textContent='◈ '+reasonResp.slice(0,200)+'...';
    }catch{}
  }

  const typingEl=appendTyping();
  S.isStreaming=true;
  document.getElementById('send-btn').disabled=true;

  let fullResp='';
  const model=document.getElementById('model-select').value;

  try {
    if(S.apiKey){
      const msgEl=appendMsg('arya','','ARYA AI');
      const contentEl=msgEl.querySelector('.msg-content');
      contentEl.classList.add('stream-cursor');
      typingEl.remove();

      fullResp=await openaiChat(msgs,model,true,(chunk)=>{
        fullResp+=chunk;
        contentEl.innerHTML=renderMarkdown(fullResp);
        document.getElementById('chat-messages').scrollTop=9999;
      });
      contentEl.classList.remove('stream-cursor');
      contentEl.innerHTML=renderMarkdown(fullResp);
    } else {
      await delay(1000); typingEl.remove();
      fullResp=getDemoResponse(text);
      appendMsg('arya',renderMarkdown(fullResp),'ARYA AI');
    }

    S.chatHistory.push({role:'user',content:hasImg?text:text});
    S.chatHistory.push({role:'assistant',content:fullResp});
    if(S.chatHistory.length>20) S.chatHistory=S.chatHistory.slice(-20);
    updateCtxTokens();

    if(S.ttsEnabled && fullResp) speakText(fullResp.replace(/[#*`]/g,'').slice(0,400));

  } catch(err){
    typingEl.remove();
    appendMsg('arya',`<div class="msg-error">⚠️ Hata: ${err.message}</div>`,'ARYA AI');
  } finally {
    S.isStreaming=false;
    document.getElementById('send-btn').disabled=false;
    setThinking(false);
    updateMemoryUI();
  }
}

function setThinking(v){
  const dot=document.getElementById('qi-dot')||document.querySelector('.qi-dot');
  const lbl=document.getElementById('qi-label');
  if(dot) dot.className='qi-dot'+(v?' thinking':'');
  if(lbl) lbl.textContent=v?'Düşünüyor...':'Hazır';
}

function appendMsg(role,html,name){
  const msgs=document.getElementById('chat-messages');
  const d=document.createElement('div'); d.className=`msg ${role}`;
  d.innerHTML=`<div class="msg-avatar">${role==='arya'?'A':'S'}</div><div class="msg-body"><div class="msg-name">${name}</div><div class="msg-content">${html}</div></div>`;
  msgs.appendChild(d); msgs.scrollTop=msgs.scrollHeight; return d;
}

function appendTyping(){
  const msgs=document.getElementById('chat-messages');
  const d=document.createElement('div'); d.className='msg arya';
  d.innerHTML='<div class="msg-avatar">A</div><div class="msg-body"><div class="msg-name">ARYA AI</div><div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div></div>';
  msgs.appendChild(d); msgs.scrollTop=msgs.scrollHeight; return d;
}

function appendThinkBubble(text){
  const msgs=document.getElementById('chat-messages');
  const d=document.createElement('div'); d.className='msg arya';
  const b=document.createElement('div'); b.className='think-bubble'; b.textContent='◈ '+text;
  d.innerHTML='<div class="msg-avatar">A</div>'; const body=document.createElement('div'); body.className='msg-body'; body.appendChild(b); d.appendChild(body);
  msgs.appendChild(d); msgs.scrollTop=msgs.scrollHeight; return b;
}

// ── MARKDOWN RENDERER ─────────────────────
function renderMarkdown(text){
  if(!document.getElementById('md-toggle')?.checked) return escHtml(text).replace(/\n/g,'<br>');
  return text
    .replace(/```(\w*)\n?([\s\S]*?)```/g,(_,lang,code)=>`<pre><code class="lang-${lang}">${escHtml(code.trim())}</code></pre>`)
    .replace(/`([^`\n]+)`/g,'<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>')
    .replace(/\*([^*\n]+)\*/g,'<em>$1</em>')
    .replace(/^### (.+)$/gm,'<h3>$1</h3>')
    .replace(/^## (.+)$/gm,'<h2>$1</h2>')
    .replace(/^# (.+)$/gm,'<h1>$1</h1>')
    .replace(/^\| (.+) \|$/gm,(_,row)=>`<tr>${row.split('|').map(c=>`<td>${c.trim()}</td>`).join('')}</tr>`)
    .replace(/(<tr>.*<\/tr>)+/gs, t=>`<table>${t}</table>`)
    .replace(/^> (.+)$/gm,'<blockquote>$1</blockquote>')
    .replace(/^[-*] (.+)$/gm,'<li>$1</li>')
    .replace(/(<li>.*<\/li>)+/gs,l=>`<ul>${l}</ul>`)
    .replace(/^\d+\. (.+)$/gm,'<li>$1</li>')
    .replace(/\n\n/g,'<br><br>')
    .replace(/\n(?!<)/g,'<br>');
}

function escHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ── IMAGE UPLOAD (CHAT) ───────────────────
function handleImageUpload(e){
  const file=e.target.files[0]; if(!file) return;
  const reader=new FileReader();
  reader.onload=ev=>{
    S.pendingImage=ev.target.result;
    document.getElementById('image-preview-chip').classList.remove('hidden');
    document.getElementById('preview-thumb').src=ev.target.result;
  };
  reader.readAsDataURL(file);
}
function removeImagePreview(){ S.pendingImage=null; document.getElementById('image-preview-chip').classList.add('hidden'); document.getElementById('img-upload').value=''; }

// ── VOICE INPUT ───────────────────────────
let _recognition=null;
function toggleVoice(){
  const btn=document.getElementById('voice-btn');
  if(_recognition){ _recognition.stop(); _recognition=null; btn.classList.remove('recording'); return; }
  if(!('webkitSpeechRecognition' in window||'SpeechRecognition' in window)){ showToast('Tarayıcınız ses tanımayı desteklemiyor.','warn'); return; }
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  _recognition=new SR(); _recognition.lang='tr-TR'; _recognition.continuous=false; _recognition.interimResults=true;
  _recognition.onstart=()=>btn.classList.add('recording');
  _recognition.onresult=e=>{ const t=e.results[e.results.length-1][0].transcript; document.getElementById('chat-input').value=t; autoResize(document.getElementById('chat-input')); };
  _recognition.onend=()=>{ btn.classList.remove('recording'); _recognition=null; };
  _recognition.onerror=()=>{ btn.classList.remove('recording'); _recognition=null; };
  _recognition.start();
}

// ── TTS ───────────────────────────────────
function initTTSVoices(){
  const load=()=>{ S.ttsVoices=window.speechSynthesis.getVoices(); const sel=document.getElementById('tts-voice-select'); if(sel){ sel.innerHTML=''; S.ttsVoices.forEach((v,i)=>{ const o=document.createElement('option'); o.value=i; o.textContent=`${v.name} (${v.lang})`; sel.appendChild(o); }); } };
  window.speechSynthesis.onvoiceschanged=load; load();
}
function speakText(text){
  window.speechSynthesis.cancel();
  const utt=new SpeechSynthesisUtterance(text);
  const vi=parseInt(document.getElementById('tts-voice-select')?.value||0);
  if(S.ttsVoices[vi]) utt.voice=S.ttsVoices[vi];
  utt.rate=parseFloat(document.getElementById('tts-rate')?.value||100)/100;
  window.speechSynthesis.speak(utt);
}

// ── VISION PAGE ───────────────────────────
function handleVisionDrop(e){ e.preventDefault(); const f=e.dataTransfer.files[0]; if(f?.type.startsWith('image/')) loadVisionImage(f); }
function handleVisionFile(e){ const f=e.target.files[0]; if(f) loadVisionImage(f); }
function loadVisionImage(file){
  const reader=new FileReader();
  reader.onload=ev=>{
    S.visionImageData=ev.target.result;
    document.getElementById('vision-preview').innerHTML=`<img src="${ev.target.result}" style="max-width:100%;max-height:260px;object-fit:contain;border-radius:8px">`;
    document.getElementById('vision-result').innerHTML='<span style="color:var(--q-primary)">Görsel yüklendi. Analiz için bir araç seçin.</span>';
  };
  reader.readAsDataURL(file);
}

const VISION_PROMPTS={
  analyze:'Bu görseli profesyonel bir görüntü analisti gibi derinlemesine analiz et. Kompozisyon, renkler, ışık, nesneler, bağlam, teknik kalite ve öne çıkan detayları açıkla.',
  describe:'Bu görseli en az 200 kelimeyle detaylıca açıkla. Ne görüyorsun? Ortam, nesneler, renkler, atmosfer nedir?',
  objects:'Bu görseldeki tüm nesneleri, kişileri ve öğeleri listele. Her birinin konumunu ve güven yüzdesini belirt.',
  text:'Bu görseldeki tüm yazılı metni (OCR) aynen çıkar. Tüm görünür metni kopyala.',
  emotion:'Bu görselin duygusal analizini yap. Hangi duyguları uyandırıyor? Renk psikolojisi, kompozisyon etkisi, izleyici tepkisi nedir?',
  code:'Bu görsel bir UI/kod/diyagram ise, içeriğini koda çevir veya detaylı teknik açıklama yap.',
};

async function visionAction(type){
  if(!S.visionImageData){ showToast('Önce bir görsel yükleyin.','warn'); return; }
  const resultEl=document.getElementById('vision-result');
  resultEl.innerHTML='<span style="color:var(--q-primary)">Analiz ediliyor...</span>';
  try{
    let resp;
    if(S.apiKey){
      resp=await openaiVision(S.visionImageData,VISION_PROMPTS[type]);
    } else {
      await delay(800);
      resp='Demo mod: Görsel analizi için OpenAI API anahtarı gerekli. Ayarlar sayfasından ekleyebilirsiniz.';
    }
    resultEl.innerHTML=renderMarkdown(resp);
  }catch(err){
    resultEl.innerHTML=`<span style="color:var(--danger)">Hata: ${err.message}</span>`;
  }
}

// ── IMAGE GENERATION ─────────────────────
async function generateImage(){
  const prompt=document.getElementById('image-prompt').value.trim();
  if(!prompt){ showToast('Görsel tanımı girin.','warn'); return; }
  if(!S.apiKey){ showToast('DALL-E 3 için API anahtarı gerekli.','warn'); return; }
  const size=document.getElementById('image-size').value;
  const quality=document.getElementById('image-quality').value;
  const gallery=document.getElementById('gen-gallery');
  const btn=document.getElementById('gen-img-btn');
  btn.disabled=true; btn.textContent='Üretiliyor...';
  const card=document.createElement('div'); card.className='gen-image-card';
  card.innerHTML='<div class="gen-loading"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>';
  gallery.insertBefore(card,gallery.firstChild);
  try{
    const url=await openaiDalle(prompt,size,quality);
    card.innerHTML=`<img src="${url}" alt="${escHtml(prompt)}" loading="lazy"><button class="img-download" onclick="downloadImg('${url}','arya-img.png')">İndir</button>`;
  }catch(err){
    card.innerHTML=`<div style="padding:16px;font-size:.8rem;color:var(--danger)">Hata: ${err.message}</div>`;
  } finally{
    btn.disabled=false; btn.textContent='Üret';
  }
}
function downloadImg(url,name){ const a=document.createElement('a'); a.href=url; a.download=name; a.target='_blank'; a.click(); }

// ── VIDEO (Multi-frame DALL-E) ────────────
async function generateVideo(){
  const prompt=document.getElementById('video-prompt').value.trim();
  if(!prompt){ showToast('Senaryo girin.','warn'); return; }
  if(!S.apiKey){ showToast('Video üretimi için API anahtarı gerekli.','warn'); return; }
  const frameCount=parseInt(document.getElementById('video-frames').value);
  const style=document.getElementById('video-style').value;
  const quality=document.getElementById('video-quality').value;
  const btn=document.getElementById('gen-video-btn');
  const progressEl=document.getElementById('video-progress');
  const fillEl=document.getElementById('vp-fill');
  const pctEl=document.getElementById('vp-pct');
  const framesGrid=document.getElementById('video-frames-grid');
  btn.disabled=true; progressEl.style.display='block'; framesGrid.innerHTML='';

  const framePrompts=[];
  for(let i=0;i<frameCount;i++) framePrompts.push(`${style} stil video karesi ${i+1}/${frameCount}: ${prompt}. Sinematik kompozisyon, ${i===0?'başlangıç':i===frameCount-1?'bitiş':'orta'} sahnesi.`);

  for(let i=0;i<frameCount;i++){
    try{
      fillEl.style.width=((i/frameCount)*100)+'%'; pctEl.textContent=Math.round((i/frameCount)*100)+'%';
      const url=await openaiDalle(framePrompts[i],'1792x1024',quality);
      const card=document.createElement('div'); card.className='vf-card';
      card.innerHTML=`<img src="${url}" alt="Kare ${i+1}" loading="lazy"><div class="vf-label">Kare ${i+1} / ${frameCount}</div>`;
      framesGrid.appendChild(card);
    }catch(err){
      const card=document.createElement('div'); card.className='vf-card';
      card.innerHTML=`<div style="padding:16px;font-size:.8rem;color:var(--danger)">Kare ${i+1} hatası</div>`;
      framesGrid.appendChild(card);
    }
  }
  fillEl.style.width='100%'; pctEl.textContent='100%';
  document.getElementById('video-preview').innerHTML=`<div style="text-align:center;padding:20px"><div style="font-size:2.5rem">🎬</div><div style="font-family:'Orbitron',sans-serif;color:var(--q-primary);margin:8px 0">${frameCount} kare üretildi</div><div style="font-size:.8rem;color:var(--text-muted)">${style} · ${quality.toUpperCase()}</div></div>`;
  btn.disabled=false;
}

// ══════════════════════════════════════════
//  WEB AUDIO ENGINE — Gerçek Müzik Sentezi
// ══════════════════════════════════════════
const NOTE_FREQ = {
  'C':261.63,'D':293.66,'E':329.63,'F':349.23,'G':392.00,'A':440.00,'B':493.88,
  'C#':277.18,'D#':311.13,'F#':369.99,'G#':415.30,'A#':466.16,
};

const SCALES = {
  major:[0,2,4,5,7,9,11], minor:[0,2,3,5,7,8,10], pentatonic:[0,2,4,7,9],
  blues:[0,3,5,6,7,10], dorian:[0,2,3,5,7,9,10],
};

const CHORD_PROGS = {
  'Klasik':[[0,4,7],[5,9,12],[7,11,14],[0,4,7]],
  'Pop':[[0,4,7],[7,11,14],[9,12,16],[5,9,12]],
  'Jazz':[[2,5,9],[7,10,14],[0,4,7],[0,4,7]],
  'Electronic':[[0,7,12],[5,9,15],[3,7,10],[0,7,12]],
  'Ambient':[[0,4,7,11],[5,9,12,16],[7,11,14,17],[0,4,7,11]],
  'Dramatik':[[0,3,7],[8,11,15],[5,9,12],[0,3,7]],
  'Huzurlu':[[0,4,7,11],[5,9,12],[2,5,9],[0,4,7]],
};

class AudioEngine {
  constructor(){
    this.ctx=new (window.AudioContext||window.webkitAudioContext)();
    this.master=this.ctx.createGain(); this.master.gain.value=0.7;
    this.compressor=this.ctx.createDynamicsCompressor(); this.compressor.threshold.value=-20; this.compressor.ratio.value=4;
    this.reverb=this.createReverb();
    this.master.connect(this.compressor); this.compressor.connect(this.ctx.destination);
    this.nodes=[];
  }

  createReverb(){
    const len=this.ctx.sampleRate*2, buf=this.ctx.createBuffer(2,len,this.ctx.sampleRate);
    for(let c=0;c<2;c++){ const d=buf.getChannelData(c); for(let i=0;i<len;i++) d[i]=(Math.random()*2-1)*Math.pow(1-i/len,2); }
    const conv=this.ctx.createConvolver(); conv.buffer=buf;
    const wet=this.ctx.createGain(); wet.gain.value=0.2; conv.connect(wet); wet.connect(this.ctx.destination);
    return conv;
  }

  getFreq(rootNote, semitones, octave){
    const base=NOTE_FREQ[rootNote]||261.63;
    return base * Math.pow(2, (semitones + (octave-4)*12) / 12);
  }

  createOscillator(freq, type, startTime, duration, gain=0.3){
    const osc=this.ctx.createOscillator(); osc.type=type; osc.frequency.value=freq;
    const env=this.ctx.createGain();
    const att=0.02, dec=0.1, sus=0.6, rel=0.3;
    env.gain.setValueAtTime(0, startTime);
    env.gain.linearRampToValueAtTime(gain, startTime+att);
    env.gain.linearRampToValueAtTime(gain*sus, startTime+att+dec);
    env.gain.setValueAtTime(gain*sus, startTime+duration-rel);
    env.gain.linearRampToValueAtTime(0, startTime+duration);
    osc.connect(env); env.connect(this.master); env.connect(this.reverb);
    osc.start(startTime); osc.stop(startTime+duration+0.1);
    this.nodes.push(osc);
    return osc;
  }

  playChord(notes, startTime, duration, type='sine', gain=0.2){
    notes.forEach(freq=> this.createOscillator(freq, type, startTime, duration, gain/notes.length));
  }

  async compose(params){
    const {genre,bpm,key,octave,instType}=params;
    const beatDur=60/bpm;
    const scale=SCALES[genre==='Jazz'?'dorian':genre==='Blues'?'blues':genre==='Electronic'||genre==='Ambient'?'pentatonic':'major'];
    const prog=CHORD_PROGS[genre]||CHORD_PROGS['Pop'];
    const totalBars=8; const beatsPerBar=4;
    const now=this.ctx.currentTime+0.1;
    let t=now;

    // Melody
    const melodyNotes=[];
    for(let bar=0;bar<totalBars;bar++){
      const chord=prog[bar%prog.length];
      for(let beat=0;beat<beatsPerBar;beat++){
        const semi=scale[Math.floor(Math.random()*scale.length)]+(bar%2===0?0:12);
        const freq=this.getFreq(key.replace('m','').replace('Am','A').replace('Em','E').replace('Dm','D'), semi, parseInt(octave));
        melodyNotes.push({freq,t,dur:beatDur*(Math.random()>.6?.5:1)});
        t+=beatDur;
      }
    }

    // Play melody
    melodyNotes.forEach(n=> this.createOscillator(n.freq, instType||'sine', n.t, n.dur, 0.25));

    // Play chords (background)
    const chordRoot=key.replace('m','').replace('Am','A').replace('Em','E').replace('Dm','D');
    let ct=now;
    for(let bar=0;bar<totalBars;bar++){
      const chord=prog[bar%prog.length];
      const freqs=chord.map(s=>this.getFreq(chordRoot, s, parseInt(octave)-1));
      this.playChord(freqs, ct, beatDur*4, 'triangle', 0.15);
      ct+=beatDur*4;
    }

    // Bass line
    let bt=now;
    for(let bar=0;bar<totalBars;bar++){
      const root=prog[bar%prog.length][0];
      const freq=this.getFreq(chordRoot, root, parseInt(octave)-2);
      for(let beat=0;beat<4;beat+=2){
        this.createOscillator(freq, 'sine', bt+beat*beatDur, beatDur*1.8, 0.3);
      }
      bt+=beatDur*4;
    }

    return totalBars * beatsPerBar * beatDur;
  }

  stopAll(){ this.nodes.forEach(n=>{ try{n.stop(this.ctx.currentTime+0.05);}catch{} }); this.nodes=[]; }
  setVolume(v){ this.master.gain.setTargetAtTime(v/100, this.ctx.currentTime, 0.01); }
  resume(){ if(this.ctx.state==='suspended') this.ctx.resume(); }
}

// ── MUSIC UI ─────────────────────────────
function toggleInst(btn){ document.querySelectorAll('.inst-btn').forEach(b=>b.classList.remove('active')); btn.classList.add('active'); }

let _playInterval=null, _playElapsed=0, _playTotal=0;

async function composeAndPlay(){
  if(!S.musicEngine) S.musicEngine=new AudioEngine();
  S.musicEngine.resume();
  S.musicEngine.stopAll();
  clearInterval(_playInterval); S.isPlaying=false;

  const genre=document.getElementById('music-genre').value;
  const bpm=parseInt(document.getElementById('music-bpm').value);
  const key=document.getElementById('music-key').value;
  const octave=document.getElementById('music-octave').value;
  const instBtn=document.querySelector('.inst-btn.active');
  const instType=instBtn?.dataset.inst||'sine';

  const btn=document.getElementById('compose-btn');
  btn.disabled=true; btn.textContent='Bestelenyor...';

  try{
    const duration=await S.musicEngine.compose({genre,bpm,key,octave,instType});
    _playTotal=Math.ceil(duration); _playElapsed=0;
    S.isPlaying=true;
    document.getElementById('play-btn').textContent='⏸';
    document.getElementById('mp-title').textContent=`${genre} — ${key}`;
    document.getElementById('mp-sub').textContent=`${bpm} BPM · ${instBtn?.textContent||'Piyano'}`;
    document.getElementById('mp-total').textContent=fmtDur(_playTotal);
    S.musicTracks.push({title:`${genre} — ${key}`,meta:`${bpm} BPM`,duration:_playTotal,instType});
    S.currentTrack=S.musicTracks.length-1;
    addMusicTrack(S.currentTrack);
    startViz();
    _playInterval=setInterval(()=>{
      if(!S.isPlaying) return;
      _playElapsed++;
      const pct=Math.min((_playElapsed/_playTotal)*100,100);
      document.getElementById('mp-fill').style.width=pct+'%';
      document.getElementById('mp-current').textContent=fmtDur(_playElapsed);
      if(_playElapsed>=_playTotal){ clearInterval(_playInterval); S.isPlaying=false; document.getElementById('play-btn').textContent='▶'; stopViz(); }
    },1000);
  }catch(err){ showToast('Müzik hatası: '+err.message,'warn'); }
  finally{ btn.disabled=false; btn.textContent='Bestele & Çal'; }
}

function togglePlay(){ S.isPlaying=!S.isPlaying; document.getElementById('play-btn').textContent=S.isPlaying?'⏸':'▶'; if(S.isPlaying){S.musicEngine?.resume();startViz();}else stopViz(); }
function stopMusic(){ if(S.musicEngine){ S.musicEngine.stopAll(); S.isPlaying=false; document.getElementById('play-btn').textContent='▶'; clearInterval(_playInterval); stopViz(); } }
function rewindMusic(){ _playElapsed=0; document.getElementById('mp-fill').style.width='0%'; document.getElementById('mp-current').textContent='0:00'; }
function setVolume(v){ S.musicEngine?.setVolume(parseInt(v)); }

function exportMusicWav(){
  if(!S.musicEngine){ showToast('Önce müzik oluşturun.','warn'); return; }
  showToast('Web Audio kayıt için OfflineAudioContext gerekli — bu özellik yakında!','warn');
}

function addMusicTrack(idx){
  const t=S.musicTracks[idx]; if(!t) return;
  const lib=document.getElementById('music-library');
  const d=document.createElement('div'); d.className='music-track'; d.dataset.idx=idx;
  d.innerHTML=`<span class="mt-play">▶</span><div class="mt-info"><div class="mt-name">${t.title}</div><div class="mt-meta">${t.meta}</div></div><span class="mt-dur">${fmtDur(t.duration)}</span>`;
  d.onclick=()=>{ S.currentTrack=idx; composeAndPlay(); };
  lib.appendChild(d);
}

function initVizBars(){
  const c=document.getElementById('viz-bars'); c.innerHTML='';
  for(let i=0;i<40;i++){ const b=document.createElement('div'); b.className='viz-bar'; b.style.height='3px'; c.appendChild(b); }
}

function startViz(){
  clearInterval(S.vizInterval);
  S.vizInterval=setInterval(()=>{
    document.querySelectorAll('.viz-bar').forEach(b=>{ b.style.height=(Math.random()*60+4)+'px'; });
  },120);
}

function stopViz(){
  clearInterval(S.vizInterval);
  document.querySelectorAll('.viz-bar').forEach(b=>b.style.height='3px');
}

function fmtDur(s){ return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`; }

// ── MEMORY ───────────────────────────────
function saveMemory(item){ item.id=Date.now(); item.time=new Date().toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'}); S.memory.unshift(item); if(S.memory.length>CFG.maxMemory) S.memory=S.memory.slice(0,CFG.maxMemory); localStorage.setItem('arya_memory',JSON.stringify(S.memory)); document.getElementById('mem-count').textContent=S.memory.length+' kayıt'; }

function updateMemoryUI(){
  const chat=S.memory.filter(m=>m.type==='chat').length;
  const learn=S.memory.filter(m=>m.type==='learn').length;
  const pref=S.memory.filter(m=>m.type==='pref').length;
  document.getElementById('total-mem').textContent=S.memory.length;
  document.getElementById('chat-mem').textContent=chat;
  document.getElementById('learn-mem').textContent=learn;
  document.getElementById('pref-mem').textContent=pref;
  document.getElementById('mem-count').textContent=S.memory.length+' kayıt';
  const ctxTok=S.context.reduce((a,c)=>a+(c.content?.length||0),0);
  document.getElementById('ctx-mem').textContent=Math.round(ctxTok/4);
  updateCtxTokens();
  const list=document.getElementById('memory-list');
  if(!S.memory.length){ list.innerHTML='<div class="empty-state">Sohbet ettikçe ARYA öğrenir.</div>'; return; }
  list.innerHTML=S.memory.slice(0,60).map(m=>`<div class="memory-item"><span class="mi-type ${m.type}">${m.type==='chat'?'SOHBET':m.type==='learn'?'ÖĞRENME':'TERCİH'}</span><span class="mi-text">${escHtml(m.text)}</span><span class="mi-time">${m.time}</span><button class="mi-del" onclick="deleteMemory(${m.id})">×</button></div>`).join('');
}

function searchMemory(){ const q=document.getElementById('memory-search').value.toLowerCase(); const r=q?S.memory.filter(m=>m.text.toLowerCase().includes(q)):S.memory; const list=document.getElementById('memory-list'); list.innerHTML=r.length?r.slice(0,60).map(m=>`<div class="memory-item"><span class="mi-type ${m.type}">${m.type==='chat'?'SOHBET':m.type==='learn'?'ÖĞRENME':'TERCİH'}</span><span class="mi-text">${escHtml(m.text)}</span><span class="mi-time">${m.time}</span><button class="mi-del" onclick="deleteMemory(${m.id})">×</button></div>`).join(''):'<div class="empty-state">Sonuç bulunamadı.</div>'; }
function deleteMemory(id){ S.memory=S.memory.filter(m=>m.id!==id); localStorage.setItem('arya_memory',JSON.stringify(S.memory)); updateMemoryUI(); }
function clearMemory(){ if(confirm('Tüm hafıza silinecek?')){ S.memory=[]; localStorage.removeItem('arya_memory'); updateMemoryUI(); } }
function addMemory(){ const t=prompt('Hafızaya not ekle:'); if(t?.trim()) { saveMemory({type:'pref',text:t.trim()}); updateMemoryUI(); } }
function exportMemory(){ const blob=new Blob([JSON.stringify(S.memory,null,2)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='arya-memory.json'; a.click(); }

function updateCtxTokens(){ const t=Math.round((S.context.reduce((a,c)=>a+(c.content?.length||0),0)+S.chatHistory.reduce((a,m)=>a+(m.content?.length||0),0))/4); document.getElementById('ctx-tokens').textContent=t+' tok'; }

// ── TRAINING / CONTEXT ────────────────────
async function handleTrainFile(event, type){
  const files=[...event.target.files]; if(!files.length) return;
  const statusEl=document.getElementById(`ts-${type}`); statusEl.textContent='Okunuyor...'; statusEl.style.color='var(--warning)';
  for(const file of files){
    try{
      const text=await file.text();
      S.context.push({name:file.name, type, content:text.slice(0,8000), size:file.size});
      localStorage.setItem('arya_context',JSON.stringify(S.context));
      statusEl.textContent=`✓ ${files.length} dosya yüklendi`;
      statusEl.style.color='var(--success)';
      saveMemory({type:'learn',text:`${type} eğitim: ${file.name}`});
    }catch(e){ statusEl.textContent='Hata: '+e.message; }
  }
  updateContextUI(); updateMemoryUI();
}

async function handleTrainImageFile(event){
  const files=[...event.target.files]; if(!files.length) return;
  if(!S.apiKey){ showToast('Görsel analizi için API anahtarı gerekli.','warn'); return; }
  const statusEl=document.getElementById('ts-image'); statusEl.textContent='Analiz ediliyor...'; statusEl.style.color='var(--warning)';
  for(const file of files){
    const reader=new FileReader();
    reader.onload=async ev=>{
      try{
        const desc=await openaiVision(ev.target.result,'Bu görseli detaylıca açıkla. İçeriğini, nesneleri ve bağlamını anlat.');
        S.context.push({name:file.name,type:'image',content:`[GÖRSEL TANIM: ${file.name}]\n${desc}`,size:file.size});
        localStorage.setItem('arya_context',JSON.stringify(S.context));
        statusEl.textContent='✓ Analiz tamamlandı'; statusEl.style.color='var(--success)';
        updateContextUI();
      }catch(e){ statusEl.textContent='Hata: '+e.message; }
    };
    reader.readAsDataURL(file);
  }
}

function saveManualContext(){
  const t=document.getElementById('manual-context').value.trim(); if(!t) return;
  S.context.push({name:'Manuel Bağlam '+new Date().toLocaleDateString('tr-TR'),type:'manual',content:t,size:t.length});
  localStorage.setItem('arya_context',JSON.stringify(S.context));
  document.getElementById('manual-context').value='';
  updateContextUI(); showToast('Bağlam kaydedildi!');
}

function updateContextUI(){
  const list=document.getElementById('context-list');
  const totalChars=S.context.reduce((a,c)=>a+(c.content?.length||0),0);
  document.getElementById('ctx-size-label').textContent=`· ${S.context.length} öğe · ~${Math.round(totalChars/4)} token`;
  if(!S.context.length){ list.innerHTML='<div class="empty-state" style="padding:20px">Henüz bağlam yüklenmedi.</div>'; return; }
  list.innerHTML=S.context.map((c,i)=>`<div class="trained-item"><span class="ti-icon">${c.type==='image'?'🖼️':c.type==='code'?'💻':c.type==='manual'?'✍️':'📄'}</span><span class="ti-name" title="${escHtml(c.name)}">${escHtml(c.name)}</span><span class="ti-size">${Math.round((c.content?.length||0)/4)} tok</span><button class="ti-del" onclick="deleteContext(${i})">×</button></div>`).join('');
}

function deleteContext(idx){ S.context.splice(idx,1); localStorage.setItem('arya_context',JSON.stringify(S.context)); updateContextUI(); }
function clearAllContext(){ if(confirm('Tüm bağlam silinecek?')){ S.context=[]; localStorage.removeItem('arya_context'); updateContextUI(); } }

// ── DEEP THINK ────────────────────────────
async function startDeepThink(){
  const query=document.getElementById('think-query').value.trim();
  if(!query){ showToast('Soru girin.','warn'); return; }
  const output=document.getElementById('think-output'); output.innerHTML='';
  const btn=document.getElementById('think-btn'); btn.disabled=true; btn.textContent='Düşünüyor...';
  const showSteps=document.getElementById('think-show-steps').checked;
  const selfCrit=document.getElementById('think-self-critique').checked;
  const multiAngle=document.getElementById('think-multi-angle').checked;
  const prosCons=document.getElementById('think-pros-cons').checked;

  const addStep=(type,label,text)=>{
    const d=document.createElement('div'); d.className=`think-step ${type}`;
    d.innerHTML=`<div class="ts-label">${label}</div><div class="ts-text">${renderMarkdown(text)}</div>`;
    output.appendChild(d); output.scrollTop=output.scrollHeight;
  };

  try{
    if(S.apiKey && showSteps){
      addStep('reasoning','Soru Analizi','Sorgu işleniyor, anahtar kavramlar tespit ediliyor...');
      const analysis=await openaiChat([{role:'system',content:'Türkçe yanıt ver. Bu soruyu 2-3 cümleyle analiz et.'},{role:'user',content:query}],document.getElementById('model-select').value,false);
      output.lastElementChild.querySelector('.ts-text').innerHTML=renderMarkdown(analysis);

      if(multiAngle){
        addStep('analysis','Çok Açılı Analiz','Perspektifler değerlendiriliyor...');
        const angles=await openaiChat([{role:'system',content:'Türkçe. En az 3 farklı perspektiften kısa analiz yap.'},{role:'user',content:query}],document.getElementById('model-select').value,false);
        output.lastElementChild.querySelector('.ts-text').innerHTML=renderMarkdown(angles);
      }
      if(prosCons){
        addStep('analysis','Artı/Eksi Analizi','Avantajlar ve dezavantajlar...');
        const pc=await openaiChat([{role:'system',content:'Türkçe. Artılar ve eksiler listesi yap.'},{role:'user',content:query}],document.getElementById('model-select').value,false);
        output.lastElementChild.querySelector('.ts-text').innerHTML=renderMarkdown(pc);
      }

      addStep('conclusion','Sonuç ve Yanıt','Sentez yapılıyor...');
      const final=await openaiChat([{role:'system',content:PERSONALITIES.default},{role:'user',content:query}],document.getElementById('model-select').value,false);
      output.lastElementChild.querySelector('.ts-text').innerHTML=renderMarkdown(final);

      if(selfCrit){
        addStep('critique','Öz-Eleştiri','Yanıt sorgulanıyor...');
        const crit=await openaiChat([{role:'system',content:'Türkçe. Bu yanıtı eleştir, eksiklerini ve güçlü yönlerini belirt.'},{role:'user',content:`Yanıt: ${final}`}],document.getElementById('model-select').value,false);
        output.lastElementChild.querySelector('.ts-text').innerHTML=renderMarkdown(crit);
      }
    } else if(S.apiKey){
      const resp=await openaiChat([{role:'system',content:PERSONALITIES.default},{role:'user',content:query}],document.getElementById('model-select').value,false);
      addStep('conclusion','Yanıt',resp);
    } else {
      // Demo
      await delay(600); addStep('reasoning','Analiz',`"${query}" sorusu alındı ve işlendi.`);
      await delay(600); addStep('analysis','Değerlendirme','Çoklu perspektifler değerlendirildi. Demo modda simüle edilmiş sonuç.');
      await delay(600); addStep('conclusion','Sonuç','Demo mod: Tam derin analiz için OpenAI API anahtarı gerekli.');
    }
  }catch(err){
    addStep('critique','Hata',`API Hatası: ${err.message}`);
  } finally{
    btn.disabled=false; btn.textContent='Derin Analiz Başlat';
  }
}

// ── SETTINGS ─────────────────────────────
function changeTheme(v){ document.body.className=v==='quantum'?'':v; }
function toggleAnimations(){ const e=document.getElementById('anim-toggle').checked; document.querySelectorAll('.ring,.mring,.wc-ring').forEach(el=>el.style.animationPlayState=e?'running':'paused'); }
function toggleBg(){ document.getElementById('quantum-bg').style.opacity=document.getElementById('bg-toggle').checked?'1':'0'; }
function exportAllData(){ const d={memory:S.memory,context:S.context.map(c=>({name:c.name,type:c.type,size:c.size})),chatHistory:S.chatHistory,exported:new Date().toISOString()}; const blob=new Blob([JSON.stringify(d,null,2)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='arya-ai-backup.json'; a.click(); }
function deleteAllData(){ if(confirm('TÜM veri silinecek!')){ localStorage.clear(); S.memory=[]; S.context=[]; S.chatHistory=[]; updateMemoryUI(); updateContextUI(); showToast('Tüm veri silindi.'); } }

// ── DEMO RESPONSES ────────────────────────
function getDemoResponse(text){
  const l=text.toLowerCase();
  if(/merhaba|selam|hey/i.test(l)) return 'Merhaba! Ben ARYA AI. Demo moddasınız. Tüm özellikleri açmak için Ayarlar\'dan OpenAI API anahtarınızı ekleyin.';
  if(/kod|python|javascript|program/i.test(l)) return `Elbette! İşte bir örnek:\n\n\`\`\`python\n# ARYA AI — Demo\ndef quantum_ai(prompt):\n    return f"Yanıt: {prompt[::-1]}"\n\nprint(quantum_ai("Merhaba Dünya"))\n\`\`\`\n\n*Demo mod: Tam yanıtlar için API anahtarı gerekli.*`;
  if(/kuantum|quantum/i.test(l)) return '**Kuantum Hesaplama**, klasik bilgisayarların 0/1 bitleri yerine **kubitler** kullanan devrimci bir teknolojidir.\n\n- **Süperpozisyon**: Aynı anda 0 ve 1\n- **Dolanıklık**: Anlık iletişim\n- **Girişim**: Hata minimizasyonu\n\n*Demo mod — tam yanıt için API anahtarı ekleyin.*';
  return `Demo mod yanıtı: "${text.slice(0,50)}..." konusunda size yardımcı olmak isterim.\n\n**Tam güç için:** Ayarlar → OpenAI API Anahtarı → Kaydet\n\nBu adımdan sonra GPT-4o ile gerçek zamanlı, akıllı yanıtlar alırsınız.`;
}

// ── TOAST ─────────────────────────────────
function showToast(msg, type='ok'){
  const t=document.createElement('div');
  t.style.cssText=`position:fixed;bottom:24px;right:24px;z-index:9999;padding:12px 20px;border-radius:10px;font-size:.85rem;font-family:'Inter',sans-serif;max-width:320px;backdrop-filter:blur(12px);animation:msg-in .3s ease;${type==='warn'?'background:rgba(255,170,0,.15);border:1px solid rgba(255,170,0,.4);color:#ffaa00':'background:rgba(0,212,255,.12);border:1px solid rgba(0,212,255,.3);color:#00d4ff'}`;
  t.textContent=msg; document.body.appendChild(t);
  setTimeout(()=>t.remove(),3500);
}

// ── UTILS ─────────────────────────────────
function delay(ms){ return new Promise(r=>setTimeout(r,ms)); }
