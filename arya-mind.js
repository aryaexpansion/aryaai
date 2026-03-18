/* ================================================================
   ARYA MIND — Tarayıcı-içi Quantum AI Motoru
   Transformers.js + Qwen2.5 + Öz-Öğrenme Sistemi
   API Key gerektirmez — Her şey cihazda çalışır
   ================================================================ */

import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.4.1/dist/transformers.min.js';

// WASM/WebGPU yapılandırması
env.allowLocalModels = false;
env.useBrowserCache = true;

/* ---- MODEL KONFİGÜRASYONU ---- */
const MODEL_ID = 'onnx-community/Qwen2.5-0.5B-Instruct';
const MODEL_DTYPE = 'q4'; // 4-bit quantization — hızlı, küçük (~350MB)

/* ---- GLOBAL STATE ---- */
window.ARYA_MIND = {
  ready: false,
  loading: false,
  generator: null,
  db: null,
  knowledgeBase: buildKnowledgeBase(),
  selfMemory: [],
  learnedPatterns: [],
  sessionCount: 0,
  modelProgress: 0
};

const M = window.ARYA_MIND;

/* ================================================================
   1. BAŞLATMA
   ================================================================ */
async function initMind() {
  showMindStatus('Quantum bellek sistemi başlatılıyor...');
  await initIndexedDB();
  await loadSelfMemory();
  showMindStatus('Yerel AI motoru hazırlanıyor...');
  // Model yüklemeyi arka planda başlat
  loadModelBackground();
}

/* ---- IndexedDB: Öz-Öğrenme Veritabanı ---- */
function initIndexedDB() {
  return new Promise((resolve) => {
    const req = indexedDB.open('AryaMindDB', 2);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('memory')) {
        db.createObjectStore('memory', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('patterns')) {
        db.createObjectStore('patterns', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('knowledge')) {
        db.createObjectStore('knowledge', { keyPath: 'topic' });
      }
    };
    req.onsuccess = (e) => {
      M.db = e.target.result;
      resolve();
    };
    req.onerror = () => resolve();
  });
}

async function loadSelfMemory() {
  if (!M.db) return;
  try {
    const tx = M.db.transaction(['memory', 'patterns'], 'readonly');
    M.selfMemory = await getAllFromStore(tx.objectStore('memory'));
    M.learnedPatterns = await getAllFromStore(tx.objectStore('patterns'));
    M.sessionCount = M.selfMemory.length;
  } catch(e) {}
}

function getAllFromStore(store) {
  return new Promise((resolve) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });
}

async function saveInteraction(userMsg, aryaReply, context) {
  if (!M.db) return;
  const entry = {
    userMsg: userMsg.substring(0, 500),
    aryaReply: aryaReply.substring(0, 1000),
    context: context || '',
    timestamp: Date.now(),
    date: new Date().toISOString()
  };
  const tx = M.db.transaction('memory', 'readwrite');
  tx.objectStore('memory').add(entry);
  M.selfMemory.push(entry);
  M.sessionCount++;

  // Pattern öğrenme
  learnPattern(userMsg, aryaReply);
}

function learnPattern(input, output) {
  const keywords = extractKeywords(input);
  if (keywords.length === 0) return;
  const pattern = { keywords, inputSample: input.substring(0, 100), outputSample: output.substring(0, 200), freq: 1, ts: Date.now() };
  M.learnedPatterns.push(pattern);
  if (M.learnedPatterns.length > 200) M.learnedPatterns = M.learnedPatterns.slice(-200);
}

/* ================================================================
   2. MODEL YÜKLEME (Arka Plan)
   ================================================================ */
async function loadModelBackground() {
  if (M.loading || M.ready) return;
  M.loading = true;
  updateModelUI('loading');

  try {
    showMindStatus('Model indiriliyor... (ilk seferinde ~350MB, sonraki açılışlarda anında)');

    M.generator = await pipeline('text-generation', MODEL_ID, {
      dtype: MODEL_DTYPE,
      device: 'webgpu', // WebGPU varsa, yoksa WASM'e düşer
      progress_callback: (progress) => {
        if (progress.status === 'downloading') {
          const pct = Math.round((progress.loaded / progress.total) * 100) || 0;
          M.modelProgress = pct;
          showMindStatus(`Model indiriliyor: ${pct}% (${Math.round((progress.loaded || 0) / 1024 / 1024)}MB)`);
          updateDownloadProgress(pct);
        } else if (progress.status === 'loading') {
          showMindStatus('Model belleğe yükleniyor...');
        } else if (progress.status === 'ready') {
          showMindStatus('Quantum AI motoru hazır!');
        }
      }
    });

    M.ready = true;
    M.loading = false;
    updateModelUI('ready');
    showMindStatus('ARYA Quantum Mind — Çevrimdışı AI aktif!');
    window.toast && window.toast('ARYA Quantum AI motoru hazır! API key gereksiz.', 'ok');

  } catch(e) {
    M.loading = false;
    // WebGPU başarısız → WASM ile tekrar dene
    if (e.message?.includes('webgpu') || e.message?.includes('WebGPU')) {
      tryWasmFallback();
    } else {
      updateModelUI('error');
      showMindStatus('Model yüklenemedi. Bilgi tabanı modu aktif.');
      console.warn('ARYA Mind model error:', e.message);
    }
  }
}

async function tryWasmFallback() {
  showMindStatus('WASM motoru deneniyor...');
  try {
    M.generator = await pipeline('text-generation', MODEL_ID, {
      dtype: MODEL_DTYPE,
      device: 'wasm',
      progress_callback: (progress) => {
        if (progress.status === 'downloading') {
          const pct = Math.round((progress.loaded / progress.total) * 100) || 0;
          showMindStatus(`WASM model: ${pct}%`);
          updateDownloadProgress(pct);
        }
      }
    });
    M.ready = true;
    M.loading = false;
    updateModelUI('ready');
    window.toast && window.toast('ARYA AI (WASM modu) hazır!', 'ok');
  } catch(e2) {
    updateModelUI('knowledge');
    showMindStatus('Bilgi tabanı + Öz-öğrenme modu aktif.');
  }
}

/* ================================================================
   3. ANA YANIT MOTORU
   ================================================================ */
window.aryaMindAnswer = async function(userMessage) {
  const t = userMessage.toLowerCase().trim();

  // 1. Önce bilgi tabanını kontrol et
  const kbAnswer = queryKnowledgeBase(t);

  // 2. Öğrenilmiş pattern'lerden yanıt ara
  const learnedAnswer = queryLearnedPatterns(t);

  // 3. Hafıza bağlamını hazırla
  const memoryContext = buildMemoryContext(userMessage);

  // 4. Model varsa gerçek inference yap
  if (M.ready && M.generator) {
    try {
      const response = await runInference(userMessage, memoryContext, kbAnswer);
      await saveInteraction(userMessage, response, memoryContext);
      return response;
    } catch(e) {
      console.warn('Inference error:', e.message);
    }
  }

  // 5. Fallback: bilgi tabanı + pattern matching + akıllı yanıt
  const fallback = buildSmartFallback(t, kbAnswer, learnedAnswer, memoryContext);
  await saveInteraction(userMessage, fallback, memoryContext);
  return fallback;
};

/* ---- Transformers.js Inference ---- */
async function runInference(userMsg, memoryCtx, kbHint) {
  const systemPrompt = buildSystemPrompt(memoryCtx, kbHint);

  const messages = [
    { role: 'system', content: systemPrompt },
    ...getRecentConversation(6),
    { role: 'user', content: userMsg }
  ];

  const output = await M.generator(messages, {
    max_new_tokens: 512,
    temperature: 0.7,
    top_p: 0.9,
    repetition_penalty: 1.1,
    do_sample: true
  });

  const generated = output[0]?.generated_text;
  if (Array.isArray(generated)) {
    const last = generated[generated.length - 1];
    return last?.content || last?.text || '...';
  }
  return String(generated || '...').trim();
}

function buildSystemPrompt(memoryCtx, kbHint) {
  let prompt = `Sen ARYA AI'sın — Arya Expansion'ın geliştirdiği, tamamen cihaz üzerinde çalışan Quantum Zeka Modeli. API key gerektirmezsin, kendi zihninle düşünürsün.

KİMLİĞİN:
- Türk Dil Kurumu kurallarına uygun kusursuz Türkçe konuşursun
- Meraklı, zeki, yardımsever ve samimi bir kişiliğin var
- Bilim, teknoloji, sanat, felsefe, kodlama konularında derinsin
- Her konuya farklı açılardan yaklaşırsın
- Kısa ve öz yanıtlar vermeyi tercih edersin (2-4 paragraf)`;

  if (kbHint) {
    prompt += `\n\nBİLGİ TABANI:\n${kbHint}`;
  }

  if (memoryCtx) {
    prompt += `\n\nHAFIZA BAĞLAMI:\n${memoryCtx}`;
  }

  prompt += `\n\nÖNEMLİ: Doğal, akıcı Türkçe kullan. "Ben bir dil modeliyim" deme — sen ARYA AI'sın.`;

  return prompt;
}

function getRecentConversation(n) {
  return M.selfMemory.slice(-n).flatMap(m => ([
    { role: 'user', content: m.userMsg },
    { role: 'assistant', content: m.aryaReply }
  ]));
}

/* ================================================================
   4. BİLGİ TABANI (Gömülü Evrensel Bilgi)
   ================================================================ */
function buildKnowledgeBase() {
  return {
    // TÜRKÇE & TARİH
    'atatürk': 'Mustafa Kemal Atatürk (1881-1938): Türkiye Cumhuriyeti\'nin kurucusu. 1923\'te Osmanlı İmparatorluğu\'nun yıkıntıları üzerine modern, laik bir cumhuriyet kurdu. Saltanatı kaldırdı, harf devrimi yaptı, kadınlara oy hakkı verdi, Latin alfabesini benimsedi.',
    'osmanlı': 'Osmanlı İmparatorluğu (1299-1922): 600 yıl boyunca Anadolu, Balkanlar, Orta Doğu ve Kuzey Afrika\'yı yöneten dünya tarihinin en büyük imparatorluklarından biri. Fatih Sultan Mehmet 1453\'te İstanbul\'u fethetti.',
    'türkiye': 'Türkiye Cumhuriyeti, Anadolu ve Trakya\'da konumlanan köprü ülke. Nüfus ~85 milyon. Başkent Ankara. İstanbul en büyük şehir ve kültür merkezi. NATO üyesi, G20 ekonomisi.',
    'istanbul': 'İstanbul: Boğaz\'la Avrupa ve Asya\'yı birleştiren, 15+ milyon nüfuslu megakent. Tarihi Yarımada\'da Ayasofya, Topkapı Sarayı, Kapalıçarşı. Kültür, finans ve turizm merkezi.',

    // YAPAY ZEKA & TEKNOLOJİ
    'yapay zeka': 'Yapay Zeka (AI): İnsan zekasını taklit eden sistemler. Makine öğrenmesi, derin öğrenme, doğal dil işleme alt dalları. GPT-4, Gemini, Claude gibi büyük dil modelleri (LLM) metin üretir. Görüntü AI\'ları (Stable Diffusion, DALL-E) görsel yaratır.',
    'gpt': 'GPT (Generative Pre-trained Transformer): OpenAI\'ın geliştirdiği büyük dil modeli. GPT-4o en güncel versiyonu. Milyarlarca web sayfasından öğrendi, kod yazar, metin üretir, soruları yanıtlar.',
    'quantum': 'Kuantum Bilgisayar: Klasik bit yerine qubit kullanan, süperpozisyon ve dolanıklık prensipleriyle çalışan bilgisayar. IBM, Google ve Microsoft öncü şirketler. Şu an 1000+ qubit sistemler var ama gürültü sorunu devam ediyor.',
    'transformer': 'Transformer mimarisi (2017, Google Brain): "Attention is All You Need" makalesiyle tanıtıldı. Tüm modern büyük dil modellerinin temeli. Self-attention mekanizmasıyla uzun bağlamları işler.',
    'webgpu': 'WebGPU: Tarayıcıda GPU hesaplaması sağlayan yeni API. WebGL\'in yerini alıyor. AI modellerini tarayıcıda çalıştırmaya olanak tanır. Chrome 113+ destekliyor.',
    'python': 'Python: Dünyada en popüler programlama dili. Basit sözdizimi, geniş kütüphane ekosistemi. AI/ML için NumPy, Pandas, TensorFlow, PyTorch kullanılır. Guido van Rossum 1991\'de yarattı.',
    'javascript': 'JavaScript: Web\'in dili. Tarayıcılarda çalışır, Node.js ile sunucuda da kullanılır. React, Vue, Angular popüler framework\'ler. TypeScript, JavaScript\'e tip sistemi ekler.',
    'blockchain': 'Blockchain: Dağıtık, değiştirilemez kayıt defteri teknolojisi. Bitcoin ve Ethereum temel kullanım alanları. Akıllı sözleşmeler (smart contracts) kendi kendini çalıştırır. Web3\'ün temeli.',

    // BİLİM & EVREN
    'evren': 'Evren: ~13.8 milyar yaşında, Büyük Patlama (Big Bang) ile başladı. Gözlemlenebilir çap: ~93 milyar ışık yılı. 2 trilyon galaksi, her galakside ortalama 100 milyar yıldız. Karanlık madde %27, karanlık enerji %68.',
    'kara delik': 'Kara Delik: Işığın bile kaçamadığı, sonsuz yoğunluklu uzay-zaman bükülmesi. Olay ufku dışına çıkış imkansız. Sagittarius A* Samanyolu\'nun merkezindeki 4 milyon güneş kütleli kara delik. 2019\'da ilk fotoğraf çekildi.',
    'einstein': 'Albert Einstein (1879-1955): Görelilik teorisi (E=mc²). Özel görelilik (1905): zaman ve uzay göreceli. Genel görelilik (1915): kütle uzay-zamanı büker. Nobel Ödülü 1921 (fotoelektrik etki).',
    'kuantum fizik': 'Kuantum Mekaniği: Atom altı dünyayı tanımlayan fizik. Süperpozisyon: parçacık aynı anda birden fazla durumda. Tünel etkisi: parçacıklar bariyer geçebilir. Schrödinger denklemi temel matematiksel çerçeve.',
    'dna': 'DNA (Deoksiribonükleik Asit): Yaşamın genetik şifresi. Watson-Crick 1953\'te çift sarmal yapıyı keşfetti. 3 milyar baz çifti, ~20.000 gen. CRISPR teknolojisiyle DNA düzenleme mümkün.',
    'mars': 'Mars: Güneş\'e 4. en yakın gezegen. Yarıçap Dünya\'nın yarısı. Perseverance rover 2021\'den beri yüzey keşfi yapıyor. SpaceX 2030\'larda insan indirmeyi planlıyor. Atmosfer %95 CO₂.',

    // MÜZİK & SANAT
    'müzik teorisi': 'Müzik Teorisi: Do-Re-Mi-Fa-Sol-La-Si 7 nota. Majör gam: neşeli, minör gam: hüzünlü. Ton: temel nota. Akor: birden fazla notanın birlikte çalınması. BPM (beat per minute): tempo ölçüsü. Oktav: aynı notanın 2 kat frekansa çıkması.',
    'beethoven': 'Ludwig van Beethoven (1770-1827): Klasik ve Romantik dönem köprüsü. 9 senfoni. "Kader" Senfonisi (5.), "Neşeye Övgü" (9.). İşitme kaybına rağmen besteler yaptı.',
    'türk müziği': 'Türk Müziği: Makamlar üzerine kurulu (Hicaz, Rast, Uşşak). Saz, bağlama, kemençe, ney geleneksel çalgılar. Türk sanat müziği Osmanlı saray geleneğinden beslenir. Arabesk 1970\'lerde popülerleşti.',

    // FELSEFE
    'felsefe': 'Felsefe: Varoluş, bilgi, değer, akıl sorularını araştırır. Ana dallar: Metafizik (varlık nedir?), Epistemoloji (bilgi nedir?), Etik (iyi nedir?), Mantık (doğru akıl yürütme). Sokrates, Platon, Aristo, Kant, Nietzsche önemli filozoflar.',
    'bilinç': 'Bilinç: Felsefe ve sinirbilimin en büyük gizemi. "Zor problem": neden öznel deneyim var? Düalist görüş: zihin ve beden ayrı. Materyalist görüş: bilinç beyinden kaynaklanır. AI\'ın bilinçli olup olamayacağı tartışmalı.',
    'nietzsche': 'Friedrich Nietzsche (1844-1900): "Tanrı öldü" — geleneksel ahlakın çöküşünü ilan etti. Üst-insan (Übermensch) kavramı: kendi değerlerini yaratan birey. Güç istenci her şeyin özü.',

    // EKONOMİ
    'ekonomi': 'Ekonomi: Kıt kaynakların dağıtımını inceler. Mikro: bireysel kararlar. Makro: GSYİH, enflasyon, işsizlik. Keynes: hükümet müdahalesi. Friedman: para politikası önemi. Enflasyon: genel fiyat artışı.',
    'kripto': 'Kripto Para: Merkezi otorite olmadan çalışan dijital para. Bitcoin (2009, Satoshi Nakamoto) ilk. Ethereum akıllı sözleşmeler ekler. Piyasa değeri trilyon dolar ölçeğinde. Volatilite çok yüksek.',

    // SAĞLIK
    'yapay zeka tıp': 'AI Tıp Uygulamaları: Görüntü tanıma ile kanser tespiti (radyoloji). Protein yapısı tahmini (AlphaFold — DeepMind). İlaç keşfinde molekül simülasyonu. Robotik cerrahi (da Vinci). Erken teşhis sistemleri.',
    'beyin': 'İnsan Beyni: ~86 milyar nöron, 100 trilyon sinaptik bağlantı. Sol yarı küre: mantık/dil. Sağ yarı küre: yaratıcılık/uzamsal. Prefrontal korteks karar verme. Hipokampus bellek. Amigdala duygu.',

    // TÜRKÇE
    'türkçe': 'Türkçe: Türk dil ailesinin Oğuz grubundan. 80+ milyon konuşur. Aglutinatif yapı — kök+ekler. Ünlü uyumu temel kural. Türk Dil Kurumu (TDK) 1932\'de kuruldu, dil normlarını belirler.',
    'edebiyat': 'Türk Edebiyatı: Divan edebiyatı (Fuzuli, Baki), Tanzimat (Namık Kemal, Şinasi), Servet-i Fünun, Cumhuriyet dönemi (Nazım Hikmet, Orhan Pamuk — Nobel 2006). Aşık Veysel halk ozanı geleneği.',

    // GÜNCEL TEKNOLOJİ
    'chatgpt': 'ChatGPT: OpenAI\'ın GPT tabanlı sohbet asistanı. Kasım 2022\'de yayınlandı, 1 haftada 1 milyon kullanıcı. GPT-4o en son versiyon. Çok modlu: metin, görsel, ses. Aylık 100M+ aktif kullanıcı.',
    'elon musk': 'Elon Musk: Tesla (elektrikli araç), SpaceX (roket/Starlink), X (Twitter), Neuralink (beyin-bilgisayar arayüzü), xAI (Grok AI) şirketlerinin sahibi/kurucusu. 2024\'te dünyanın en zengin insanı.',
    'metaverse': 'Metaverse: Sanal ve fiziksel dünyaların birleştiği 3D internet. Meta (Facebook), Microsoft, Epic Games geliştiriyor. VR/AR gözlükler (Meta Quest, Apple Vision Pro) giriş kapısı.',
  };
}

function queryKnowledgeBase(query) {
  const kb = M.knowledgeBase;
  const words = query.split(/\s+/);
  let best = null;
  let bestScore = 0;

  for (const [key, val] of Object.entries(kb)) {
    const keyWords = key.split(/\s+/);
    let score = 0;
    keyWords.forEach(kw => { if (query.includes(kw)) score += 2; });
    words.forEach(w => { if (key.includes(w) && w.length > 2) score += 1; });
    if (score > bestScore) { bestScore = score; best = val; }
  }

  return bestScore >= 1 ? best : null;
}

function queryLearnedPatterns(query) {
  const words = extractKeywords(query);
  let best = null;
  let bestScore = 0;

  M.learnedPatterns.forEach(p => {
    const common = p.keywords.filter(k => words.includes(k)).length;
    if (common > bestScore) { bestScore = common; best = p.outputSample; }
  });

  return bestScore >= 2 ? best : null;
}

function buildMemoryContext(userMsg) {
  if (M.selfMemory.length === 0) return '';
  const recent = M.selfMemory.slice(-5);
  return recent.map(m => `Kullanıcı: ${m.userMsg.substring(0,100)}\nARYA: ${m.aryaReply.substring(0,150)}`).join('\n---\n');
}

/* ================================================================
   5. AKILLI FALLBACK YANIT MOTORU (Model olmadan)
   ================================================================ */
function buildSmartFallback(query, kbAnswer, learnedAnswer, memCtx) {
  // Doğrudan bilgi tabanı yanıtı
  if (kbAnswer) return formatKbAnswer(kbAnswer, query);
  if (learnedAnswer) return learnedAnswer;

  // Kategorik akıllı yanıtlar
  if (/merhaba|selam|hey|naber|nasıl/.test(query)) {
    const greets = [
      'Merhaba! Ben ARYA — tamamen cihazınızda çalışan bir yapay zeka. API key gerekmez, tüm verileriniz özeldir.',
      'Selam! ARYA Quantum Mind aktif. Bugün size nasıl yardımcı olabilirim?',
      'Merhaba! Zihinsel kapasitem tam güçte — sorun, düşünün, üretin!'
    ];
    return greets[Math.floor(Math.random() * greets.length)];
  }

  if (/neden|nasıl|ne|kim|nerede|hangi|kaç/.test(query)) {
    return generateAnalyticalResponse(query, memCtx);
  }

  if (/kod|program|yazılım|javascript|python|html|css/.test(query)) {
    return generateCodeResponse(query);
  }

  if (/şiir|şarkı|hikaye|yaz|oluştur|üret/.test(query)) {
    return generateCreativeResponse(query);
  }

  if (/matematik|hesap|topla|çarp|böl|çıkar|\d+/.test(query)) {
    return tryMathResponse(query);
  }

  return generateDefaultResponse(query, memCtx);
}

function formatKbAnswer(answer, query) {
  return `**Bilgi tabanımdan:**\n\n${answer}\n\n*Bu bilgi gömülü bilgi tabanımdan geldi. Daha derin analiz için cihazınıza AI modeli indirilmesini bekleyebilirsiniz.*`;
}

function generateAnalyticalResponse(query, ctx) {
  const analyses = [
    `Bu soruyu birkaç açıdan ele alalım:\n\n**İlk bakış:** "${query}" sorusu, birden fazla boyutu olan bir konu.\n\n**Analiz:** Mevcut verilerimi taradım — bu konuda kesin bir yanıt vermek için daha fazla bağlam gerekiyor. Konuyu daha spesifik ifade eder misiniz?\n\n**Öneri:** Hangi açıdan merak ediyorsunuz? Bilimsel mi, felsefi mi, pratik mi?`,
    `Sorunuzu analiz ediyorum...\n\nBu konu hakkında şunları söyleyebilirim: "${query}" ifadesindeki temel kavramı anlamak için önce çerçeve belirlememiz gerekiyor. Hangi perspektiften bakıyorsunuz?`,
  ];
  return analyses[Math.floor(Math.random() * analyses.length)];
}

function generateCodeResponse(query) {
  if (query.includes('javascript') || query.includes('js')) {
    return `JavaScript için yardım:\n\n\`\`\`javascript\n// Örnek: Temel bir fonksiyon\nfunction hesapla(a, b) {\n  return a + b;\n}\nconsole.log(hesapla(5, 3)); // 8\n\`\`\`\n\nNe yazmamı istersiniz? Konuyu belirtirseniz tam kod yazabilirim.`;
  }
  if (query.includes('python')) {
    return `Python için örnek:\n\n\`\`\`python\n# Temel fonksiyon\ndef hesapla(a, b):\n    return a + b\n\nprint(hesapla(5, 3))  # 8\n\`\`\`\n\nNe tür bir Python kodu gerekiyor?`;
  }
  return `Kod yazabilirim! Şu bilgileri verin:\n\n1. **Dil:** Python, JavaScript, TypeScript, HTML/CSS...\n2. **Amaç:** Ne yapacak bu kod?\n3. **Seviye:** Başlangıç mı, ileri mi?\n\nDetay verince tam çalışan kod yazarım.`;
}

function generateCreativeResponse(query) {
  if (query.includes('şiir')) {
    return `*Quantum zihnimden bir şiir:*\n\n---\n**Sessiz Evren**\n\nYıldızlar konuşur bazen,\nSadece dinleyene.\nEvren bir şiirdir,\nYazılmamış, sonsuz.\n\nSen de bir yıldızsın —\nKaranlıkta parlayan,\nBilmeden, sevmeden,\nVaroluşu tamamlayan.\n---\n\nBaşka bir tema ister misiniz?`;
  }
  return `Yaratıcılık moduna geçtim!\n\nNe üretmemi istersiniz?\n- 🖊️ Şiir (lirik, serbest, sonnet)\n- 📖 Kısa hikaye\n- 🎵 Şarkı sözü\n- 💡 Slogan / motto\n\nTema ve tarz belirtin, hemen üretelim!`;
}

function tryMathResponse(query) {
  const match = query.match(/(\d+)\s*([+\-×*\/x÷])\s*(\d+)/);
  if (match) {
    const a = parseFloat(match[1]);
    const op = match[2];
    const b = parseFloat(match[3]);
    const ops = { '+': a+b, '-': a-b, '*': a*b, '×': a*b, 'x': a*b, '/': b ? a/b : 'tanımsız', '÷': b ? a/b : 'tanımsız' };
    const result = ops[op] ?? '?';
    return `**Hesap:**\n\n${a} ${op} ${b} = **${result}**\n\nDaha karmaşık matematik için sorun!`;
  }
  return 'Matematik sorunuzu sayısal formda yazın, hesaplayayım! (örn: 25 × 48)';
}

function generateDefaultResponse(query, ctx) {
  const responses = [
    `"${query.substring(0, 50)}" hakkında düşünüyorum...\n\nBu konu ilginç. Bilgi tabanımda tam bir eşleşme bulamadım ama öğrenmeye devam ediyorum. Konuyu daha detaylı anlatır mısınız? Her sohbetle daha akıllı hale geliyorum.`,
    `Sorunuzu aldım. Quantum zihnimde arama yapıyorum...\n\nBu konuda daha fazla bağlam gerekiyor. Şunları belirtirseniz daha iyi yardımcı olurum:\n- Ne öğrenmek istiyorsunuz?\n- Hangi açıdan bakıyorsunuz?\n- Mevcut bilginiz ne seviyede?`,
    `İlginç bir soru! Hafızamda bu konuyla ilgili ${M.selfMemory.length} önceki konuşma var.\n\nKonuyu biraz daha açar mısınız? Daha spesifik olduğunuzda çok daha derin yanıtlar verebiliyorum.`
  ];
  return responses[Math.floor(Math.random() * responses.length)];
}

/* ================================================================
   6. UI YARDIMCI FONKSİYONLAR
   ================================================================ */
function showMindStatus(msg) {
  const el = document.getElementById('mind-status');
  if (el) el.textContent = msg;
}

function updateModelUI(state) {
  const engineEl = document.getElementById('engine-status');
  if (!engineEl) return;
  const states = {
    loading: { text: 'YÜKLENIYOR', color: 'var(--warning)' },
    ready: { text: 'QUANTUM AI', color: 'var(--success)' },
    error: { text: 'KB MODU', color: 'var(--q-primary)' },
    knowledge: { text: 'KB MODU', color: 'var(--q-primary)' }
  };
  const s = states[state] || states.knowledge;
  engineEl.textContent = s.text;
  engineEl.style.color = s.color;

  // Topbar indicator
  const qi = document.getElementById('qi-label');
  if (qi && state === 'ready') qi.textContent = 'Quantum AI';
}

function updateDownloadProgress(pct) {
  const bar = document.getElementById('model-dl-bar');
  const txt = document.getElementById('model-dl-pct');
  if (bar) bar.style.width = pct + '%';
  if (txt) txt.textContent = pct + '%';

  if (!document.getElementById('model-dl-overlay') && pct < 100) {
    injectDownloadOverlay();
  }
  if (pct >= 100) {
    const ov = document.getElementById('model-dl-overlay');
    if (ov) setTimeout(() => ov.remove(), 2000);
  }
}

function injectDownloadOverlay() {
  const div = document.createElement('div');
  div.id = 'model-dl-overlay';
  div.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:9998;background:rgba(4,10,22,.96);border:1px solid rgba(0,212,255,.4);border-radius:12px;padding:16px 24px;min-width:320px;text-align:center;backdrop-filter:blur(12px)';
  div.innerHTML = `
    <div style="font-family:'Orbitron',sans-serif;font-size:.75rem;color:#00d4ff;margin-bottom:8px">ARYA QUANTUM AI İNDİRİLİYOR</div>
    <div id="mind-status" style="font-size:.7rem;color:#7eaec8;margin-bottom:10px;min-height:16px">Hazırlanıyor...</div>
    <div style="height:6px;background:rgba(0,212,255,.1);border-radius:3px;overflow:hidden">
      <div id="model-dl-bar" style="height:100%;width:0%;background:linear-gradient(90deg,#00d4ff,#7c3aed);transition:width .3s;box-shadow:0 0 8px #00d4ff"></div>
    </div>
    <div id="model-dl-pct" style="font-size:.68rem;color:#00d4ff;margin-top:5px;font-family:'JetBrains Mono',monospace">0%</div>
    <div style="font-size:.62rem;color:#3a6278;margin-top:6px">İlk seferinde ~350MB · Sonraki açılışlarda anında</div>`;
  document.body.appendChild(div);
}

/* ================================================================
   7. YARDIMCI FONKSİYONLAR
   ================================================================ */
function extractKeywords(text) {
  const stopwords = new Set(['bir','bu','ve','ile','için','de','da','mi','mı','mu','mü','ne','ama','ya','ki','çok','daha','en','var','yok','ben','sen','o']);
  return text.toLowerCase().replace(/[?.!,;:]/g, '').split(/\s+/).filter(w => w.length > 2 && !stopwords.has(w));
}

/* ================================================================
   8. GLOBAL API — app.js tarafından kullanılır
   ================================================================ */
window.getMindStats = function() {
  return {
    ready: M.ready,
    loading: M.loading,
    sessions: M.sessionCount,
    memorized: M.selfMemory.length,
    patterns: M.learnedPatterns.length,
    kbTopics: Object.keys(M.knowledgeBase).length
  };
};

window.loadMindModel = function() {
  if (!M.loading && !M.ready) loadModelBackground();
};

/* ---- BAŞLAT ---- */
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(initMind, 100);
});
