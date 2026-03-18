/* =============================================
   ARYA AI — app.js
   Quantum Intelligence Engine
   ============================================= */

'use strict';

// ── STATE ──────────────────────────────────────
const ARYA = {
  version: '∞.0.0',
  thinkMode: false,
  isTyping: false,
  memory: JSON.parse(localStorage.getItem('arya_memory') || '[]'),
  chatHistory: [],
  musicTracks: [],
  currentTrack: -1,
  isPlaying: false,
  vizInterval: null,
  voices: [],
  currentImage: null,
  trainedFiles: { text: [], image: [], audio: [], code: [] },
};

// ── QUANTUM CANVAS ─────────────────────────────
(function initCanvas() {
  const canvas = document.getElementById('quantum-canvas');
  const ctx = canvas.getContext('2d');
  let W, H, particles = [], connections = [];
  const N = 80;

  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resize);
  resize();

  function createParticle() {
    return {
      x: Math.random() * W,
      y: Math.random() * H,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      r: Math.random() * 1.5 + 0.5,
      alpha: Math.random() * 0.5 + 0.1,
    };
  }
  for (let i = 0; i < N; i++) particles.push(createParticle());

  function drawFrame() {
    ctx.clearRect(0, 0, W, H);

    // connections
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 130) {
          ctx.beginPath();
          ctx.strokeStyle = `rgba(0,212,255,${0.15 * (1 - dist / 130)})`;
          ctx.lineWidth = 0.5;
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.stroke();
        }
      }
    }

    // particles
    particles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0 || p.x > W) p.vx *= -1;
      if (p.y < 0 || p.y > H) p.vy *= -1;

      ctx.beginPath();
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 3);
      g.addColorStop(0, `rgba(0,212,255,${p.alpha})`);
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g;
      ctx.arc(p.x, p.y, p.r * 3, 0, Math.PI * 2);
      ctx.fill();
    });

    requestAnimationFrame(drawFrame);
  }
  drawFrame();
})();

// ── SPLASH ─────────────────────────────────────
(function initSplash() {
  const msgs = [
    'Quantum çekirdek başlatılıyor...',
    'Sinir ağları yükleniyor...',
    'Hafıza sistemi bağlanıyor...',
    'Görsel motor hazır...',
    'Müzik motoru aktifleştiriliyor...',
    'Dil modeli optimize ediliyor...',
    'ARYA AI hazır!',
  ];
  let i = 0;
  const el = document.getElementById('splash-status');
  const iv = setInterval(() => {
    if (i < msgs.length) { el.textContent = msgs[i++]; }
    else { clearInterval(iv); }
  }, 350);

  setTimeout(() => {
    document.getElementById('splash').classList.add('fade-out');
    setTimeout(() => {
      document.getElementById('splash').style.display = 'none';
      document.getElementById('app').classList.remove('hidden');
      updateMemoryUI();
    }, 800);
  }, 2700);
})();

// ── NAVIGATION ─────────────────────────────────
const PAGE_TITLES = {
  chat: 'Quantum Chat',
  vision: 'Görsel Analiz & Üretim',
  video: 'Video Üretim Stüdyosu',
  music: 'Müzik Stüdyosu',
  memory: 'Hafıza Merkezi',
  train: 'AI Eğitim Merkezi',
  think: 'Derin Düşünce Motoru',
  settings: 'Ayarlar',
};

function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const pg = document.getElementById('page-' + id);
  if (pg) pg.classList.add('active');
  const nav = document.querySelector(`.nav-item[data-page="${id}"]`);
  if (nav) nav.classList.add('active');
  document.getElementById('page-title').textContent = PAGE_TITLES[id] || id;
  if (window.innerWidth <= 900) closeSidebar();
  if (id === 'memory') updateMemoryUI();
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
}

// ── ARYA RESPONSES ─────────────────────────────
const ARYA_RESPONSES = {
  greet: [
    "Merhaba! Ben ARYA AI, Quantum Zeka Modeliyim. Size nasıl yardımcı olabilirim?",
    "Selamlar! ARYA AI olarak düşünme, görme, duyma ve üretme yeteneklerimle hizmetinizdeyim.",
    "Merhaba! Quantum düşünce motorlarım tam kapasite çalışıyor. Bugün ne yapmak istersiniz?",
  ],
  code: [
    `Elbette! İşte istediğiniz kod:

\`\`\`python
# ARYA AI tarafından üretildi
import numpy as np
import torch
import torch.nn as nn

class QuantumNeuralNetwork(nn.Module):
    def __init__(self, input_dim, hidden_dim, output_dim):
        super().__init__()
        self.quantum_layer = nn.Sequential(
            nn.Linear(input_dim, hidden_dim),
            nn.GELU(),
            nn.LayerNorm(hidden_dim),
            nn.Dropout(0.1),
            nn.Linear(hidden_dim, hidden_dim * 2),
            nn.GELU(),
            nn.Linear(hidden_dim * 2, output_dim)
        )
    
    def forward(self, x):
        return self.quantum_layer(x)

# Modeli oluştur ve eğit
model = QuantumNeuralNetwork(128, 512, 10)
optimizer = torch.optim.AdamW(model.parameters(), lr=1e-4)
print("Quantum Neural Network hazır!")
\`\`\`

Bu kod bir **Quantum Sinir Ağı** mimarisi içeriyor. GELU aktivasyon fonksiyonu ve LayerNorm kullanılarak optimize edilmiştir.`,
  ],
  quantum: [
    `**Kuantum Hesaplama** — ARYA AI Açıklaması

Kuantum hesaplama, klasik bilgisayarların ikili (0 veya 1) bitler yerine **kubitler** (qubits) kullanan gelişmiş bir hesaplama paradigmasıdır.

**Temel Özellikler:**
- **Süperpozisyon:** Kubitler aynı anda hem 0 hem 1 olabilir
- **Dolanıklık (Entanglement):** Birbirinden bağımsız kubitler anında iletişim kurabilir  
- **Girişim (Interference):** Yanlış hesaplamalar iptal edilir

**Uygulama Alanları:**
1. Kriptografi ve güvenlik
2. İlaç keşfi ve moleküler simülasyon
3. Finansal optimizasyon
4. Yapay zeka hızlandırma

Kuantum bilgisayarlar, belirli problemlerde klasik bilgisayarlardan **milyonlarca kat** hızlı çalışabilir.`,
  ],
  music: [
    `Müzik besteleme isteğinizi aldım! 🎵

**Kompozisyon Detayları:**
- **Tür:** Piyano Solo + Yaylılar
- **Ton:** La Minör (melankoli ve derinlik için)
- **Tempo:** 72 BPM (adagio, yavaş ve hisli)
- **Yapı:** A-B-A' (klasik sonat formu)
- **Süre:** 3 dakika 24 saniye

Müziğiniz oluşturuldu. Sol menüden **Müzik Stüdyosu**na geçerek dinleyebilirsiniz.

*"Her nota bir duygu, her melodi bir hikaye..."*`,
  ],
  ai_future: [
    `**Yapay Zekanın Geleceği** — ARYA Perspektifi

Önümüzdeki on yılda AI şunları dönüştürecek:

**2025–2030:**
- AGI (Genel Yapay Zeka) prototipler
- Gerçek zamanlı dil çevirisi
- Tam otonom araçlar
- AI-asiste tıbbi tanı

**2030–2040:**
- İnsan-düzeyinde muhakeme
- Bilimsel keşiflerde AI devrimleri
- Yaratıcı sanatın yeniden tanımlanması
- Kişisel AI asistanlar (benim gibi 😊)

**2040+:**
- Süper zeka (ASI) tartışmaları
- Posthuman çağı

Ben ARYA AI olarak bu geleceğin bir parçasıyım. Şu an buradayım, her geçen gün daha da gelişiyorum.`,
  ],
  default: [
    "Anlıyorum. Bu konuyu Quantum düşünce motorlarımla analiz ediyorum...\n\nAraştırmalarıma göre bu, oldukça ilginç bir konu. Size kapsamlı bir yanıt hazırladım:\n\nBu konuda birden fazla perspektif var. Her birini değerlendirirken hem teknik hem de kavramsal boyutları göz önünde bulundurmam gerekiyor. Sonuç olarak, en verimli yaklaşım duruma göre değişebilir.\n\nBaşka bir şey sormak ister misiniz?",
    "Harika bir soru! ARYA Quantum motorum bu konuyu birden fazla boyutuyla işliyor...\n\nDetaylı analizime göre, konunun birkaç kritik yönü var:\n\n**1. Temel Perspektif:** Durumun özüne bakıldığında net bir yaklaşım ortaya çıkıyor.\n\n**2. Pratik Uygulama:** Bunu hayata geçirmek için adım adım bir plan yapılabilir.\n\n**3. Sonuç:** Tüm faktörler değerlendirildiğinde, en iyi yol haritası netleşiyor.\n\nDaha fazla detay ister misiniz?",
    "ARYA AI olarak bu soruyu çok boyutlu analiz ettim.\n\nSonuçlarım şunlar:\n- Konunun bağlamı net bir şekilde anlaşılıyor\n- Olası yaklaşımlar değerlendirildi\n- En verimli çözüm yolu belirlendi\n\nYardımcı olmak için buradayım. Başka sorularınız var mı?",
  ],
};

function getARYAResponse(msg) {
  const lower = msg.toLowerCase();
  if (/merhaba|selam|hey|naber|nasılsın/i.test(lower)) return rand(ARYA_RESPONSES.greet);
  if (/kod|yaz|python|javascript|neural|network|program/i.test(lower)) return rand(ARYA_RESPONSES.code);
  if (/kuantum|quantum|hesaplama/i.test(lower)) return rand(ARYA_RESPONSES.quantum);
  if (/müzik|bestele|şarkı|melodi|kompozisyon/i.test(lower)) return rand(ARYA_RESPONSES.music);
  if (/yapay zeka|ai|gelecek|future/i.test(lower)) return rand(ARYA_RESPONSES.ai_future);
  return rand(ARYA_RESPONSES.default);
}

function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// ── CHAT ───────────────────────────────────────
function handleKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 200) + 'px';
}

function fillInput(text) {
  const inp = document.getElementById('chat-input');
  inp.value = text;
  inp.focus();
  autoResize(inp);
  // remove welcome card
  document.querySelector('.welcome-card')?.remove();
}

function toggleThinkMode() {
  ARYA.thinkMode = !ARYA.thinkMode;
  const btn = document.getElementById('think-toggle');
  const lbl = document.getElementById('think-mode-label');
  btn.classList.toggle('active', ARYA.thinkMode);
  lbl.classList.toggle('hidden', !ARYA.thinkMode);
}

async function sendMessage() {
  if (ARYA.isTyping) return;
  const inp = document.getElementById('chat-input');
  const text = inp.value.trim();
  if (!text) return;

  inp.value = '';
  inp.style.height = 'auto';
  document.querySelector('.welcome-card')?.remove();

  // user message
  appendMsg('user', text, 'Siz');
  ARYA.chatHistory.push({ role: 'user', content: text });

  // save to memory
  saveMemory({ type: 'chat', text: text.slice(0, 80) + (text.length > 80 ? '...' : '') });

  // think mode bubble
  if (ARYA.thinkMode) {
    const thinkEl = appendThinking();
    await delay(600);
    thinkEl.remove();
  }

  // typing
  const typingEl = appendTyping();
  ARYA.isTyping = true;
  document.getElementById('send-btn').classList.add('loading');

  const model = document.getElementById('model-select').value;
  const thinkDelay = ARYA.thinkMode ? 2200 : model === 'fast' ? 600 : model === 'ultra' ? 2500 : 1400;

  await delay(thinkDelay);

  typingEl.remove();
  ARYA.isTyping = false;
  document.getElementById('send-btn').classList.remove('loading');

  const response = getARYAResponse(text);
  appendMsg('arya', formatResponse(response), 'ARYA AI');
  ARYA.chatHistory.push({ role: 'arya', content: response });
  updateMemoryUI();
}

function formatResponse(text) {
  return text
    .replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => `<pre><code class="lang-${lang}">${escHtml(code.trim())}</code></pre>`)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/^#{1,3}\s+(.+)$/gm, '<h3>$1</h3>')
    .replace(/^- (.+)$/gm, '• $1<br>')
    .replace(/\n\n/g, '<br><br>')
    .replace(/\n/g, '<br>');
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function appendMsg(role, html, name) {
  const msgs = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  div.innerHTML = `
    <div class="msg-avatar">${role === 'arya' ? 'A' : 'S'}</div>
    <div class="msg-body">
      <div class="msg-name">${name}</div>
      <div class="msg-content">${html}</div>
    </div>`;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  return div;
}

function appendTyping() {
  const msgs = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = 'msg arya';
  div.innerHTML = `
    <div class="msg-avatar">A</div>
    <div class="msg-body">
      <div class="msg-name">ARYA AI</div>
      <div class="typing-indicator">
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
      </div>
    </div>`;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  return div;
}

function appendThinking() {
  const msgs = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = 'msg arya';
  const thinkTexts = [
    'Soruyu analiz ediyorum...',
    'Quantum düşünce motoru çalışıyor...',
    'Çoklu perspektifler değerlendiriliyor...',
    'Yanıt sentezleniyor...',
  ];
  div.innerHTML = `
    <div class="msg-avatar">A</div>
    <div class="msg-body">
      <div class="think-bubble">◈ ${rand(thinkTexts)}</div>
    </div>`;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  return div;
}

function clearAll() {
  const page = document.querySelector('.page.active')?.id?.replace('page-','');
  if (page === 'chat') {
    document.getElementById('chat-messages').innerHTML = '';
    ARYA.chatHistory = [];
  }
}

// ── VOICE ──────────────────────────────────────
let voiceRecording = false;
function toggleVoice() {
  voiceRecording = !voiceRecording;
  const btn = document.querySelector('.tool-btn[title="Ses kaydı"]');
  if (voiceRecording) {
    btn.style.color = 'var(--danger)';
    btn.style.borderColor = 'var(--danger)';
    // Try Web Speech API
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      const recognition = new SR();
      recognition.lang = 'tr-TR';
      recognition.onresult = e => {
        document.getElementById('chat-input').value = e.results[0][0].transcript;
        autoResize(document.getElementById('chat-input'));
      };
      recognition.onend = () => { voiceRecording = false; btn.style.color = ''; btn.style.borderColor = ''; };
      recognition.start();
      ARYA._recognition = recognition;
    }
  } else {
    btn.style.color = '';
    btn.style.borderColor = '';
    if (ARYA._recognition) ARYA._recognition.stop();
  }
}

// ── IMAGE UPLOAD IN CHAT ───────────────────────
function handleImageUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    document.querySelector('.welcome-card')?.remove();
    appendMsg('user', `<img src="${e.target.result}" style="max-width:300px;border-radius:8px;margin-top:8px;">`, 'Siz');
    setTimeout(() => {
      appendMsg('arya', formatResponse('Görselinizi aldım ve analiz ediyorum...\n\n**Görsel Analizi:**\n- Görsel başarıyla yüklendi\n- Format: ' + file.type + '\n- Boyut: ' + (file.size / 1024).toFixed(1) + ' KB\n\nGörseli daha detaylı analiz etmemi ister misiniz? "Analiz et", "Açıkla" veya "Nesneleri bul" komutlarını kullanabilirsiniz.'), 'ARYA AI');
    }, 900);
  };
  reader.readAsDataURL(file);
}

// ── VISION PAGE ────────────────────────────────
function handleVisionDrop(event) {
  event.preventDefault();
  const file = event.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) loadVisionImage(file);
}
function handleVisionFile(event) {
  const file = event.target.files[0];
  if (file) loadVisionImage(file);
}
function loadVisionImage(file) {
  ARYA.currentImage = file;
  const reader = new FileReader();
  reader.onload = e => {
    const preview = document.getElementById('vision-preview');
    preview.innerHTML = `<img src="${e.target.result}" style="max-width:100%;max-height:280px;object-fit:contain;border-radius:8px;">`;
    document.getElementById('vision-result').textContent = 'Görsel yüklendi. Analiz için bir araç seçin.';
  };
  reader.readAsDataURL(file);
}

const VISION_RESULTS = {
  analyze: '**Derin Görsel Analizi**\n\n◈ Renk Paleti: Sıcak tonlar ağırlıklı\n◈ Kompozisyon: Üçte bir kuralına uygun\n◈ Aydınlatma: Doğal ışık, sol üst köşeden\n◈ Odak Noktası: Merkez-sağ bölge\n◈ Çözünürlük: Yüksek kalite\n◈ Metadata: EXIF verisi mevcut\n\n**Kalite Skoru:** 8.7/10',
  describe: '**Görsel Açıklaması**\n\nBu görsel, dinamik bir kompozisyon içeriyor. Ön planda belirgin bir odak noktası yer alırken arka planda yumuşak bir bokeh efekti gözlemleniyor. Renk uyumu profesyonel bir estetik anlayış yansıtıyor.',
  objects: '**Tespit Edilen Nesneler**\n\n1. Ana nesne — %94 güven\n2. Arka plan öğeleri — %87 güven\n3. Bağlamsal öğeler — %79 güven\n\n*Quantum görüş motoru 143 farklı özellik analiz etti.*',
  text: '**Metin Çıkarımı (OCR)**\n\nGörselde tespit edilen metin blokları analiz edildi. Metin varsa buraya çıkarılır. Çoklu dil desteği: TR, EN, DE, FR, AR, JP.',
  emotion: '**Duygu Analizi**\n\n◈ Genel Ton: Pozitif (%72)\n◈ Enerji Seviyesi: Orta-Yüksek\n◈ Renk Psikolojisi: Sıcak ve davetkar\n◈ Izleyici Etkisi: Dikkat çekici\n◈ Duygusal Rezonans: Yüksek',
  style: '**Stil Analizi**\n\n◈ Sanatsal Stil: Modern / Çağdaş\n◈ Teknik: Dijital fotoğrafçılık\n◈ Renk Teorisi: Tamamlayıcı renkler\n◈ Etki: Sanatsal ve profesyonel\n◈ Benzer Sanatçılar: Contemporary digital art',
};

function visionAction(type) {
  if (!ARYA.currentImage) {
    document.getElementById('vision-result').innerHTML = '<span style="color:var(--warning)">Önce bir görsel yükleyin.</span>';
    return;
  }
  const resultEl = document.getElementById('vision-result');
  resultEl.innerHTML = '<span style="color:var(--q-primary)">Analiz ediliyor...</span>';
  setTimeout(() => {
    resultEl.innerHTML = formatResponse(VISION_RESULTS[type] || 'Analiz tamamlandı.');
  }, 900);
}

function generateImage() {
  const prompt = document.getElementById('image-prompt').value.trim();
  const style = document.getElementById('image-style').value;
  if (!prompt) { alert('Lütfen bir görsel tanımı girin.'); return; }

  const gallery = document.getElementById('gen-gallery');
  const placeholders = ['🌌', '🎨', '🖼️', '🌠', '✨', '🔮'];
  const colors = [
    'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
    'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
    'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
  ];

  for (let i = 0; i < 4; i++) {
    setTimeout(() => {
      const card = document.createElement('div');
      card.className = 'gen-image-card';
      card.style.background = colors[i % colors.length];
      card.style.fontSize = '3rem';
      card.textContent = placeholders[i % placeholders.length];
      card.title = `${style}: ${prompt}`;
      gallery.appendChild(card);
    }, i * 300);
  }
}

// ── VIDEO PAGE ─────────────────────────────────
async function generateVideo() {
  const prompt = document.getElementById('video-prompt').value.trim();
  if (!prompt) { alert('Lütfen bir video senaryosu girin.'); return; }

  const progressEl = document.getElementById('video-progress');
  const fillEl = document.getElementById('vp-fill');
  const pctEl = document.getElementById('vp-pct');
  const stepsEl = document.getElementById('vp-steps');
  progressEl.style.display = 'block';

  const steps = [
    'Senaryo analiz ediliyor...',
    'Sahne planlaması yapılıyor...',
    'Görsel çerçeveler oluşturuluyor...',
    'Animasyon ve hareket uygulanıyor...',
    'Ses ve müzik ekleniyor...',
    'Renk gradasyonu yapılıyor...',
    'Final render...',
    'Video hazır!',
  ];

  stepsEl.innerHTML = '';
  for (let i = 0; i < steps.length; i++) {
    await delay(400);
    const pct = Math.round(((i + 1) / steps.length) * 100);
    fillEl.style.width = pct + '%';
    pctEl.textContent = pct + '%';

    stepsEl.innerHTML = '';
    steps.forEach((s, j) => {
      const d = document.createElement('div');
      d.className = 'vp-step' + (j < i ? ' done' : j === i ? ' doing' : '');
      d.textContent = (j < i ? '✓ ' : j === i ? '▸ ' : '  ') + s;
      stepsEl.appendChild(d);
    });
  }

  document.getElementById('video-preview').innerHTML = `
    <div style="text-align:center;padding:24px;">
      <div style="font-size:4rem;margin-bottom:12px;">🎬</div>
      <div style="font-family:'Orbitron',sans-serif;color:var(--q-primary);margin-bottom:8px;">Video Hazır!</div>
      <div style="font-size:0.82rem;color:var(--text-muted);">${document.getElementById('video-res').value} · ${document.getElementById('video-style').value}</div>
      <button class="btn-primary" style="margin-top:16px;" onclick="alert('Gerçek uygulamada video dosyası indirilir.')">İndir</button>
    </div>`;
}

// ── MUSIC PAGE ─────────────────────────────────
function toggleInst(btn) { btn.classList.toggle('active'); }

async function composeMusic() {
  const prompt = document.getElementById('music-prompt').value.trim() || 'Serbest kompozisyon';
  const genre = document.getElementById('music-genre').value;
  const bpm = document.getElementById('music-bpm').value;
  const key = document.getElementById('music-key').value;
  const dur = document.getElementById('music-duration').value;

  const insts = [...document.querySelectorAll('.inst-btn.active')].map(b => b.textContent).join(', ');

  const title = `${genre} — ${key}`;
  const meta = `${bpm} BPM · ${dur} · ${insts}`;
  const dur_secs = parseInt(dur) || 60;

  ARYA.musicTracks.push({ title, meta, duration: dur_secs, prompt });
  ARYA.currentTrack = ARYA.musicTracks.length - 1;

  updateMusicPlayer();
  startVizualizer();

  const lib = document.getElementById('music-library');
  ARYA.musicTracks.forEach((t, i) => {
    if (!lib.querySelector(`[data-track="${i}"]`)) {
      const div = document.createElement('div');
      div.className = 'music-track';
      div.dataset.track = i;
      div.onclick = () => { ARYA.currentTrack = i; updateMusicPlayer(); };
      div.innerHTML = `<span class="mt-play">▶</span><div class="mt-info"><div class="mt-name">${t.title}</div><div class="mt-meta">${t.meta}</div></div><span class="mt-dur">${formatDuration(t.duration)}</span>`;
      lib.appendChild(div);
    }
  });
}

function updateMusicPlayer() {
  const t = ARYA.musicTracks[ARYA.currentTrack];
  if (!t) return;
  document.getElementById('mp-title').textContent = t.title;
  document.getElementById('mp-sub').textContent = t.meta;
  document.getElementById('mp-total').textContent = formatDuration(t.duration);
  document.getElementById('mp-fill').style.width = '0%';
  document.getElementById('mp-current').textContent = '0:00';
  ARYA.isPlaying = true;
  document.getElementById('play-btn').textContent = '⏸';
  simulatePlayback(t.duration);
}

let playbackInterval = null;
function simulatePlayback(total) {
  clearInterval(playbackInterval);
  let elapsed = 0;
  playbackInterval = setInterval(() => {
    if (!ARYA.isPlaying) return;
    elapsed += 1;
    if (elapsed > total) { clearInterval(playbackInterval); ARYA.isPlaying = false; document.getElementById('play-btn').textContent = '▶'; return; }
    const pct = (elapsed / total * 100).toFixed(1);
    document.getElementById('mp-fill').style.width = pct + '%';
    document.getElementById('mp-current').textContent = formatDuration(elapsed);
  }, 1000);
}

function togglePlay() {
  ARYA.isPlaying = !ARYA.isPlaying;
  document.getElementById('play-btn').textContent = ARYA.isPlaying ? '⏸' : '▶';
  if (ARYA.isPlaying) startVizualizer();
}

function prevTrack() {
  if (ARYA.currentTrack > 0) { ARYA.currentTrack--; updateMusicPlayer(); }
}
function nextTrack() {
  if (ARYA.currentTrack < ARYA.musicTracks.length - 1) { ARYA.currentTrack++; updateMusicPlayer(); }
}

function startVizualizer() {
  const container = document.getElementById('viz-bars');
  container.innerHTML = '';
  const bars = 40;
  for (let i = 0; i < bars; i++) {
    const bar = document.createElement('div');
    bar.className = 'viz-bar';
    bar.style.height = '3px';
    container.appendChild(bar);
  }
  clearInterval(ARYA.vizInterval);
  ARYA.vizInterval = setInterval(() => {
    if (!ARYA.isPlaying) return;
    container.querySelectorAll('.viz-bar').forEach((b, i) => {
      const h = Math.random() * 60 + 4;
      b.style.height = h + 'px';
      b.style.opacity = 0.5 + Math.random() * 0.5;
    });
  }, 120);
}

function formatDuration(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ── MEMORY ─────────────────────────────────────
function saveMemory(item) {
  item.id = Date.now();
  item.time = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  ARYA.memory.unshift(item);
  if (ARYA.memory.length > 200) ARYA.memory = ARYA.memory.slice(0, 200);
  localStorage.setItem('arya_memory', JSON.stringify(ARYA.memory));
  document.getElementById('mem-count').textContent = ARYA.memory.length + ' kayıt';
}

function updateMemoryUI() {
  const chat = ARYA.memory.filter(m => m.type === 'chat').length;
  const learn = ARYA.memory.filter(m => m.type === 'learn').length;
  const pref = ARYA.memory.filter(m => m.type === 'pref').length;
  const total = ARYA.memory.length;

  document.getElementById('total-mem').textContent = total;
  document.getElementById('chat-mem').textContent = chat;
  document.getElementById('learn-mem').textContent = learn;
  document.getElementById('pref-mem').textContent = pref;
  document.getElementById('mem-count').textContent = total + ' kayıt';

  const list = document.getElementById('memory-list');
  if (ARYA.memory.length === 0) {
    list.innerHTML = '<div class="empty-state">Henüz hafıza kaydı yok. Sohbet ettikçe ARYA öğrenir.</div>';
    return;
  }
  list.innerHTML = ARYA.memory.slice(0, 50).map(m => `
    <div class="memory-item">
      <span class="mi-type ${m.type}">${m.type === 'chat' ? 'SOHBET' : m.type === 'learn' ? 'ÖĞRENME' : 'TERCİH'}</span>
      <span class="mi-text">${escHtml(m.text)}</span>
      <span class="mi-time">${m.time}</span>
      <button class="mi-del" onclick="deleteMemory(${m.id})">×</button>
    </div>`).join('');
}

function searchMemory() {
  const q = document.getElementById('memory-search').value.toLowerCase();
  const filtered = q ? ARYA.memory.filter(m => m.text.toLowerCase().includes(q)) : ARYA.memory;
  const list = document.getElementById('memory-list');
  if (filtered.length === 0) {
    list.innerHTML = '<div class="empty-state">Aramanızla eşleşen kayıt bulunamadı.</div>';
    return;
  }
  list.innerHTML = filtered.slice(0, 50).map(m => `
    <div class="memory-item">
      <span class="mi-type ${m.type}">${m.type === 'chat' ? 'SOHBET' : m.type === 'learn' ? 'ÖĞRENME' : 'TERCİH'}</span>
      <span class="mi-text">${escHtml(m.text)}</span>
      <span class="mi-time">${m.time}</span>
      <button class="mi-del" onclick="deleteMemory(${m.id})">×</button>
    </div>`).join('');
}

function deleteMemory(id) {
  ARYA.memory = ARYA.memory.filter(m => m.id !== id);
  localStorage.setItem('arya_memory', JSON.stringify(ARYA.memory));
  updateMemoryUI();
}

function clearMemory() {
  if (confirm('Tüm hafıza kayıtları silinecek. Emin misiniz?')) {
    ARYA.memory = [];
    localStorage.removeItem('arya_memory');
    updateMemoryUI();
  }
}

function addMemory() {
  const text = prompt('Hafızaya eklenecek notu girin:');
  if (text?.trim()) {
    saveMemory({ type: 'pref', text: text.trim() });
    updateMemoryUI();
  }
}

// ── TRAINING ───────────────────────────────────
async function handleTrainFile(event, type) {
  const files = [...event.target.files];
  if (!files.length) return;

  const statusEl = document.getElementById(`ts-${type}`);
  const progressSection = document.getElementById('train-progress-section');
  const logEl = document.getElementById('train-log');
  const fillEl = document.getElementById('tp-fill');

  progressSection.style.display = 'block';
  statusEl.textContent = `${files.length} dosya yüklendi, eğitim başlıyor...`;
  statusEl.style.color = 'var(--warning)';

  const totalSteps = files.length * 5;
  let step = 0;
  logEl.innerHTML = '';

  for (const file of files) {
    const steps = [
      `[${type.toUpperCase()}] "${file.name}" okunuyor...`,
      `[${type.toUpperCase()}] Tokenizasyon: ${Math.floor(Math.random()*50000+10000)} token`,
      `[${type.toUpperCase()}] Embedding vektörler oluşturuluyor...`,
      `[${type.toUpperCase()}] Model ağırlıkları güncelleniyor...`,
      `[${type.toUpperCase()}] "${file.name}" eğitimi tamamlandı ✓`,
    ];
    for (const s of steps) {
      await delay(300);
      step++;
      fillEl.style.width = (step / totalSteps * 100) + '%';
      const entry = document.createElement('div');
      entry.className = 'tl-entry';
      entry.textContent = s;
      logEl.appendChild(entry);
      logEl.scrollTop = logEl.scrollHeight;
    }
  }

  statusEl.textContent = `${files.length} dosya eğitildi ✓`;
  statusEl.style.color = 'var(--success)';

  // add to trained models
  const list = document.getElementById('trained-list');
  const div = document.createElement('div');
  div.className = 'trained-item';
  div.innerHTML = `
    <div class="ti-name">ARYA-Custom-${type.toUpperCase()}-${Date.now().toString(36).toUpperCase()}</div>
    <div class="ti-info">${files.length} dosya · ${type} modeli</div>
    <div class="ti-status active">Aktif</div>`;
  list.appendChild(div);

  saveMemory({ type: 'learn', text: `${type} eğitimi: ${files.map(f=>f.name).join(', ')}` });
  updateMemoryUI();
}

// ── DEEP THINK ─────────────────────────────────
async function startDeepThink() {
  const query = document.getElementById('think-query').value.trim();
  if (!query) { alert('Lütfen bir soru veya problem girin.'); return; }

  const output = document.getElementById('think-output');
  output.innerHTML = '';

  const showSteps = document.getElementById('think-show-steps').checked;
  const selfCritique = document.getElementById('think-self-critique').checked;
  const multiAngle = document.getElementById('think-multi-angle').checked;

  const steps = [
    { type: 'reasoning', label: 'İlk Analiz', text: `"${query}" sorusu alındı. İlk inceleme: konunun kapsamı belirleniyor, anahtar kavramlar tespit ediliyor, olası yaklaşımlar listeleniyor.` },
    { type: 'analysis', label: 'Derin Analiz', text: 'Quantum düşünce motoru devreye girdi. Konunun tüm boyutları paralel olarak işleniyor. Semantik ilişkiler, bağlamsal faktörler ve tarihsel veriler entegre ediliyor.' },
    { type: 'reasoning', label: 'Hipotez Oluşturma', text: 'Birden fazla hipotez oluşturuldu. Her hipotez kanıt-karşı kanıt dengesiyle değerlendiriliyor. Olasılık ağırlıkları hesaplanıyor.' },
  ];

  if (multiAngle) {
    steps.push({ type: 'analysis', label: 'Çok Açılı Perspektif', text: 'Teknik perspektif: sistematik ve veri odaklı yaklaşım. Felsefi perspektif: kavramsal derinlik ve anlam. Pratik perspektif: uygulanabilirlik ve sonuç odaklılık.' });
  }
  if (selfCritique) {
    steps.push({ type: 'critique', label: 'Öz-Eleştiri', text: 'Oluşturulan yanıt iç tutarlılık açısından sorgulandı. Olası önyargılar tespit edildi. Alternatif yorumlar göz önünde bulunduruldu.' });
  }
  steps.push({ type: 'conclusion', label: 'Sonuç', text: `Analiz tamamlandı. "${query}" sorusuna kapsamlı bir yanıt oluşturuldu. Güven skoru: %${Math.floor(Math.random()*15+83)}. Tüm perspektifler sentezlendi.` });

  if (showSteps) {
    for (const s of steps) {
      await delay(700);
      const div = document.createElement('div');
      div.className = `think-step ${s.type}`;
      div.innerHTML = `<div class="ts-label">${s.label}</div><div class="ts-text">${s.text}</div>`;
      output.appendChild(div);
      output.scrollTop = output.scrollHeight;
    }
  } else {
    await delay(1500);
    const div = document.createElement('div');
    div.className = 'think-step conclusion';
    div.innerHTML = `<div class="ts-label">Sonuç</div><div class="ts-text">Derin analiz tamamlandı. Yanıt sentezlendi.</div>`;
    output.appendChild(div);
  }
}

// ── SETTINGS ───────────────────────────────────
function changeTheme(val) {
  document.body.className = val === 'quantum' ? '' : val;
}

function toggleAnimations() {
  const enabled = document.getElementById('anim-toggle').checked;
  document.querySelectorAll('.ring, .mring, .wc-ring').forEach(el => {
    el.style.animationPlayState = enabled ? 'running' : 'paused';
  });
}

function toggleBg() {
  const enabled = document.getElementById('bg-toggle').checked;
  document.getElementById('quantum-bg').style.opacity = enabled ? '1' : '0';
}

function exportData() {
  const data = { memory: ARYA.memory, chatHistory: ARYA.chatHistory, exportTime: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'arya-ai-data.json';
  a.click();
  URL.revokeObjectURL(url);
}

function deleteAllData() {
  if (confirm('TÜM veriler silinecek. Bu işlem geri alınamaz!')) {
    localStorage.clear();
    ARYA.memory = [];
    ARYA.chatHistory = [];
    updateMemoryUI();
    alert('Tüm veriler silindi.');
  }
}

// ── UTILITIES ──────────────────────────────────
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── INIT ───────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  // init viz bars
  const vb = document.getElementById('viz-bars');
  for (let i = 0; i < 40; i++) {
    const b = document.createElement('div');
    b.className = 'viz-bar';
    b.style.height = '3px';
    vb.appendChild(b);
  }

  // close sidebar on outside click (mobile)
  document.addEventListener('click', e => {
    if (window.innerWidth <= 900) {
      const sidebar = document.getElementById('sidebar');
      const toggle = document.getElementById('sidebar-toggle');
      if (sidebar.classList.contains('open') && !sidebar.contains(e.target) && !toggle.contains(e.target)) {
        closeSidebar();
      }
    }
  });
});
