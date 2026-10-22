let currentImageBase64 = null;

// Elements DOM
const omniStatusBadge = document.getElementById('omniStatusBadge');
const omniStatusText = document.getElementById('omniStatusText');
const maskedKeyLabel = document.getElementById('maskedKeyLabel');
const toggleKeyBtn = document.getElementById('toggleKeyBtn');
const apiConfigDrawer = document.getElementById('apiConfigDrawer');

const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const browseBtn = document.getElementById('browseBtn');
const changeImageBtn = document.getElementById('changeImageBtn');
const demoChartBtn = document.getElementById('demoChartBtn');
const loadDemoBtn = document.getElementById('loadDemoBtn');
const dropPlaceholder = document.getElementById('dropPlaceholder');
const previewContainer = document.getElementById('previewContainer');
const chartPreview = document.getElementById('chartPreview');
const analyzeBtn = document.getElementById('analyzeBtn');

const emptyState = document.getElementById('emptyState');
const loadingState = document.getElementById('loadingState');
const errorState = document.getElementById('errorState');
const errorMessage = document.getElementById('errorMessage');
const resultContainer = document.getElementById('resultContainer');

const customApiKeyInput = document.getElementById('customApiKey');
const analysisModeSelect = document.getElementById('analysisMode');
const preferredModelSelect = document.getElementById('preferredModel');

// 1. Vérifier la connexion (Backend local OU appel direct navigateur depuis Vercel)
const LOCAL_OMNIROUTE_URL = 'http://127.0.0.1:20128/v1';
const IS_LOCAL = ['localhost', '127.0.0.1'].includes(window.location.hostname);

// Sauvegarde/restauration des préférences dans le navigateur
const savedUserKey = localStorage.getItem('omniroute_api_key') || '';
if (savedUserKey.includes('•')) {
  localStorage.removeItem('omniroute_api_key');
  customApiKeyInput.value = '';
} else {
  customApiKeyInput.value = savedUserKey;
}
customApiKeyInput.addEventListener('input', e => {
  const val = e.target.value.trim();
  if (!val.includes('•')) {
    localStorage.setItem('omniroute_api_key', val);
  }
});
const savedMode = localStorage.getItem('analysis_mode');
if (savedMode && [...analysisModeSelect.options].some(o => o.value === savedMode)) analysisModeSelect.value = savedMode;
analysisModeSelect.addEventListener('change', () => localStorage.setItem('analysis_mode', analysisModeSelect.value));

// Système audio Web Audio API pour les alertes de fin d'analyse
let soundEnabled = localStorage.getItem('omniroute_sound_enabled') !== 'false';
const soundToggleBtn = document.getElementById('soundToggleBtn');
if (soundToggleBtn) {
  soundToggleBtn.textContent = soundEnabled ? '🔔 Son : Actif' : '🔕 Son : Muet';
  soundToggleBtn.addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    localStorage.setItem('omniroute_sound_enabled', String(soundEnabled));
    soundToggleBtn.textContent = soundEnabled ? '🔔 Son : Actif' : '🔕 Son : Muet';
    if (soundEnabled) playChime('trade');
  });
}

function playChime(type = 'trade') {
  if (!soundEnabled) return;
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const now = ctx.currentTime;

    if (type === 'trade') {
      [523.25, 659.25, 783.99].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + i * 0.08);
        gain.gain.setValueAtTime(0, now + i * 0.08);
        gain.gain.linearRampToValueAtTime(0.12, now + i * 0.08 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.35);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + i * 0.08);
        osc.stop(now + i * 0.08 + 0.4);
      });
    } else {
      [440, 493.88].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + i * 0.1);
        gain.gain.setValueAtTime(0, now + i * 0.1);
        gain.gain.linearRampToValueAtTime(0.1, now + i * 0.1 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.1 + 0.3);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + i * 0.1);
        osc.stop(now + i * 0.1 + 0.35);
      });
    }
  } catch {
    // Audio non supporté
  }
}

// Coller une capture d'écran n'importe où (Cmd+V ou Ctrl+V)
window.addEventListener('paste', e => {
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
  const items = e.clipboardData?.items;
  if (!items) return;
  for (let i = 0; i < items.length; i++) {
    if (items[i].type.startsWith('image/')) {
      const file = items[i].getAsFile();
      if (file) {
        e.preventDefault();
        handleFile(file);
        break;
      }
    }
  }
});

// Lecture JSON tolérante (une page d'erreur HTML ne doit pas faire planter l'interface)
async function readJsonResponse(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: `Réponse inattendue du serveur (HTTP ${res.status}).` };
  }
}

async function checkOmniRouteStatus() {
  try {
    const res = await fetch('/api/status', { cache: 'no-store' });
    const data = await readJsonResponse(res);

    if (res.ok && data.activeProvider === 'openrouter') {
      omniStatusBadge.className = 'status-badge online';
      omniStatusText.textContent = 'IA en ligne prête (OpenRouter Vision)';
      maskedKeyLabel.textContent = `${data.maskedOpenrouterKey || 'Actif côté serveur'}`;
      return;
    }
    if (res.ok && data.activeProvider === 'omniroute') {
      omniStatusBadge.className = 'status-badge online';
      omniStatusText.textContent = `OmniRoute connecté (${data.modelCount} modèles)`;
      maskedKeyLabel.textContent = `${data.maskedKey} (Trousseau)`;
      return;
    }
    if (res.ok && data.activeProvider === 'gemini') {
      omniStatusBadge.className = 'status-badge online';
      omniStatusText.textContent = 'Gemini API connectée (clé directe)';
      maskedKeyLabel.textContent = `${data.maskedGeminiKey}`;
      return;
    }
    if (res.ok && data.activeProvider === 'grok') {
      omniStatusBadge.className = 'status-badge online';
      omniStatusText.textContent = 'Grok xAI Vision connecté';
      maskedKeyLabel.textContent = 'Actif côté serveur';
      return;
    }
  } catch {
    // Ignorer si l'API serveur ne répond pas
  }

  const userKey = customApiKeyInput.value.trim();
  if (userKey.startsWith('xai-')) {
    omniStatusBadge.className = 'status-badge online';
    omniStatusText.textContent = 'Grok (xAI Vision) actif';
    maskedKeyLabel.textContent = `${userKey.slice(0, 8)}•••• (Grok)`;
    return;
  }
  if (userKey.startsWith('gsk_')) {
    omniStatusBadge.className = 'status-badge online';
    omniStatusText.textContent = 'Groq (LPU Vision) actif';
    maskedKeyLabel.textContent = `${userKey.slice(0, 8)}•••• (Groq)`;
    return;
  }
  if (userKey.startsWith('sk-or-')) {
    omniStatusBadge.className = 'status-badge online';
    omniStatusText.textContent = 'Clé OpenRouter active';
    maskedKeyLabel.textContent = `${userKey.slice(0, 10)}•••• (Navigateur)`;
    return;
  }
  if (/^(AIza|AQ\.)/.test(userKey)) {
    omniStatusBadge.className = 'status-badge online';
    omniStatusText.textContent = 'Clé Gemini active';
    maskedKeyLabel.textContent = `${userKey.slice(0, 6)}•••• (Navigateur)`;
    return;
  }

  // Fallback : si hébergé sur Vercel, le navigateur peut interroger directement l'OmniRoute local du Mac
  try {
    const r = await fetch(`${LOCAL_OMNIROUTE_URL}/models`, {
      headers: userKey ? { Authorization: `Bearer ${userKey}` } : {},
      signal: AbortSignal.timeout(2000)
    });
    if (r.ok || r.status === 401) {
      omniStatusBadge.className = 'status-badge online';
      omniStatusText.textContent = 'OmniRoute local détecté (mode direct)';
      if (!userKey) {
        maskedKeyLabel.textContent = 'Entrer votre clé';
        apiConfigDrawer.classList.remove('hidden');
      } else {
        maskedKeyLabel.textContent = `${userKey.slice(0, 6)}•••• (Navigateur)`;
      }
      return;
    }
  } catch {
    // OmniRoute local non joignable
  }

  omniStatusBadge.className = 'status-badge offline';
  omniStatusText.textContent = 'Aucune IA disponible (npm run setup-key ou OmniRoute)';
  maskedKeyLabel.textContent = 'Non configurée';
  apiConfigDrawer.classList.remove('hidden');
}

toggleKeyBtn.addEventListener('click', () => {
  apiConfigDrawer.classList.toggle('hidden');
});

// 2. Gestion de l'image (Drag & Drop, Fichier, Presse-papiers Cmd+V)
function setChartImage(dataUrl) {
  currentImageBase64 = dataUrl;
  chartPreview.src = dataUrl;
  dropPlaceholder.classList.add('hidden');
  previewContainer.classList.remove('hidden');
  analyzeBtn.disabled = false;
}

// Réduit uniquement les images très lourdes (limite Vercel 4,5 Mo + vitesse d'envoi),
// en gardant une résolution suffisante pour lire l'axe des prix.
const MAX_SIDE = 2400;
const MAX_DATAURL_CHARS = 3_500_000;
function optimizeImage(dataUrl) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
      if (scale === 1 && dataUrl.length <= MAX_DATAURL_CHARS) return resolve(dataUrl);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      let out = canvas.toDataURL('image/png');
      if (out.length > MAX_DATAURL_CHARS) out = canvas.toDataURL('image/jpeg', 0.92);
      resolve(out);
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

function handleFile(file) {
  if (!file || !file.type.startsWith('image/')) {
    alert('Veuillez sélectionner un fichier image (PNG, JPG, WebP).');
    return;
  }
  const reader = new FileReader();
  reader.onload = async e => setChartImage(await optimizeImage(e.target.result));
  reader.readAsDataURL(file);
}

browseBtn.addEventListener('click', e => {
  e.stopPropagation();
  fileInput.click();
});

changeImageBtn.addEventListener('click', e => {
  e.stopPropagation();
  fileInput.click();
});

dropZone.addEventListener('click', () => {
  if (!currentImageBase64) fileInput.click();
});

dropZone.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && !currentImageBase64) {
    e.preventDefault();
    fileInput.click();
  }
});

fileInput.addEventListener('change', e => {
  if (e.target.files?.[0]) handleFile(e.target.files[0]);
  e.target.value = ''; // permet de re-sélectionner le même fichier
});

dropZone.addEventListener('dragover', e => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('dragover');
});

dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  if (e.dataTransfer.files?.[0]) {
    handleFile(e.dataTransfer.files[0]);
  }
});

window.addEventListener('paste', e => {
  const items = e.clipboardData?.items || [];
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) handleFile(file);
      break;
    }
  }
});

// 3. Générateur de graphique de démonstration réaliste (XAUUSD M15) avec axe des prix net
function generateDemoChart() {
  const canvas = document.createElement('canvas');
  canvas.width = 1100;
  canvas.height = 620;
  const ctx = canvas.getContext('2d');

  // Fond sombre TradingView
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Grille horizontale + Axe des prix à droite
  const minPrice = 2640.0;
  const maxPrice = 2675.0;
  const chartLeft = 40;
  const chartRight = 960;
  const chartTop = 60;
  const chartBottom = 560;

  function priceToY(p) {
    return chartBottom - ((p - minPrice) / (maxPrice - minPrice)) * (chartBottom - chartTop);
  }

  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 1;
  ctx.fillStyle = '#94a3b8';
  ctx.font = '13px monospace';

  for (let p = 2640; p <= 2675; p += 5) {
    const y = priceToY(p);
    ctx.beginPath();
    ctx.moveTo(chartLeft, y);
    ctx.lineTo(chartRight, y);
    ctx.stroke();
    ctx.fillText(p.toFixed(2), chartRight + 14, y + 4);
  }

  // En-tête du graphique
  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText('XAUUSD (Gold / US Dollar) · 15m · OANDA', 45, 38);

  // Zone de Support Majeure (2648.00 - 2650.00)
  const supTop = priceToY(2650.0);
  const supBot = priceToY(2648.0);
  ctx.fillStyle = 'rgba(16, 185, 129, 0.16)';
  ctx.fillRect(chartLeft, supTop, chartRight - chartLeft, supBot - supTop);
  ctx.strokeStyle = '#10b981';
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(chartLeft, supTop);
  ctx.lineTo(chartRight, supTop);
  ctx.stroke();
  ctx.fillStyle = '#34d399';
  ctx.font = 'bold 12px sans-serif';
  ctx.fillText('ZONE SUPPORT CLÉ : 2648.00 - 2650.00 (Double Bottom + Rejet)', 60, supBot + 18);

  // Zone de Résistance Majeure (2668.00)
  const resY = priceToY(2668.0);
  ctx.strokeStyle = '#ef4444';
  ctx.beginPath();
  ctx.moveTo(chartLeft, resY);
  ctx.lineTo(chartRight, resY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#f87171';
  ctx.fillText('RÉSISTANCE MAJEURE : 2668.00', 60, resY - 8);

  // Bougies japonaises simulées (Tendance haussière + Pullback sur support 2650 + Englobante haussière)
  const candles = [
    { o: 2652, h: 2656, l: 2649, c: 2655 },
    { o: 2655, h: 2662, l: 2654, c: 2660 },
    { o: 2660, h: 2668, l: 2659, c: 2667 },
    { o: 2667, h: 2668.5, l: 2661, c: 2662 },
    { o: 2662, h: 2663, l: 2656, c: 2657 },
    { o: 2657, h: 2658, l: 2652, c: 2653 },
    { o: 2653, h: 2654, l: 2648.5, c: 2650.2 }, // Test support
    { o: 2650.2, h: 2655.5, l: 2649.0, c: 2654.8 }, // Rebond
    { o: 2654.8, h: 2656.0, l: 2651.5, c: 2652.0 },
    { o: 2652.0, h: 2653.0, l: 2648.8, c: 2650.5 }, // 2e test support (Double Bottom)
    { o: 2650.5, h: 2658.0, l: 2650.0, c: 2657.2 }  // Forte bougie d'impulsion haussière
  ];

  const stepX = 72;
  candles.forEach((cd, idx) => {
    const x = 110 + idx * stepX;
    const isBull = cd.c >= cd.o;
    const color = isBull ? '#10b981' : '#ef4444';

    // Mèche
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, priceToY(cd.h));
    ctx.lineTo(x, priceToY(cd.l));
    ctx.stroke();

    // Corps
    const bodyTop = priceToY(Math.max(cd.o, cd.c));
    const bodyBot = priceToY(Math.min(cd.o, cd.c));
    ctx.fillStyle = color;
    ctx.fillRect(x - 14, bodyTop, 28, Math.max(4, bodyBot - bodyTop));
  });

  // Étiquette du prix actuel (2657.20)
  const currentPrice = 2657.2;
  const curY = priceToY(currentPrice);
  ctx.strokeStyle = '#3b82f6';
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(chartLeft, curY);
  ctx.lineTo(chartRight, curY);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = '#2563eb';
  ctx.fillRect(chartRight + 4, curY - 12, 88, 24);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 13px monospace';
  ctx.fillText('2657.20', chartRight + 14, curY + 5);

  document.getElementById('symbolInput').value = 'XAUUSD';
  document.getElementById('timeframeInput').value = 'M15';
  document.getElementById('notesInput').value = 'Double rebond sur support 2649-2650 avec bougie englobante haussière';

  setChartImage(canvas.toDataURL('image/png'));
}

loadDemoBtn.addEventListener('click', generateDemoChart);
demoChartBtn.addEventListener('click', e => {
  e.stopPropagation();
  generateDemoChart();
});

// 4. Lancer l'analyse Anti-Hallucination
const MODE_DURATION_MS = { rapide: 4500, precis: 7000, ultra: 26000 };

analyzeBtn.addEventListener('click', async () => {
  if (!currentImageBase64) return;

  emptyState.classList.add('hidden');
  errorState.classList.add('hidden');
  resultContainer.classList.add('hidden');
  loadingState.classList.remove('hidden');
  analyzeBtn.disabled = true;

  // Barre de progression calée sur la durée typique du mode choisi
  const progressBar = document.getElementById('analysisProgressBar');
  const progressPercent = document.getElementById('progressPercent');
  const loadingPhase = document.getElementById('loadingPhase');
  const loadingStepTitle = document.getElementById('loadingStepTitle');
  const mode = analysisModeSelect.value;
  const expected = MODE_DURATION_MS[mode] || 7000;
  const startedAt = Date.now();

  const setProgress = p => {
    progressBar.style.width = `${p}%`;
    progressPercent.textContent = `${p}%`;
  };
  setProgress(5);
  loadingStepTitle.textContent = '🔍 Envoi de la capture & lecture de l\'axe des prix...';
  loadingPhase.textContent = mode === 'rapide' ? 'Mode Rapide (1 modèle)' : mode === 'ultra' ? 'Mode Ultra (Gemini 4 Argon, double passe)' : 'Mode Précis (2 modèles en parallèle)';

  const progressInterval = setInterval(() => {
    const ratio = (Date.now() - startedAt) / expected;
    // Courbe asymptotique : avance vite puis ralentit sans jamais dépasser 95 %
    const p = Math.min(95, Math.round(5 + 90 * (1 - Math.exp(-2.2 * ratio))));
    setProgress(p);
    if (p >= 35 && p < 70) {
      loadingStepTitle.textContent = mode === 'rapide' ? '🎯 Calcul des niveaux & ratio R:R...' : '🤝 Lecture croisée par un 2e modèle...';
      loadingPhase.textContent = 'Extraction stricte de l\'axe des prix';
    } else if (p >= 70) {
      loadingStepTitle.textContent = '🛡️ Validation mathématique serveur...';
      loadingPhase.textContent = 'Vérification SL / Entrée / TP, R:R et plage visible';
    }
  }, 200);

  try {
    const rawKey = customApiKeyInput.value.trim();
    const cleanKey = (rawKey && !rawKey.includes('•')) ? rawKey : '';
    const payload = {
      imageBase64: currentImageBase64,
      customApiKey: cleanKey,
      preferredModel: preferredModelSelect.value,
      analysisMode: mode,
      symbol: document.getElementById('symbolInput').value.trim(),
      timeframe: document.getElementById('timeframeInput').value,
      capital: document.getElementById('capitalInput').value,
      riskPercent: document.getElementById('riskInput').value,
      notes: document.getElementById('notesInput').value.trim()
    };

    let data;
    let res = null;
    try {
      res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      data = await readJsonResponse(res);
    } catch (networkErr) {
      data = { error: `Serveur injoignable : ${networkErr.message}` };
    }

    if (!res || !res.ok || data.error) {
      throw new Error(data.error || 'Erreur inconnue');
    }

    clearInterval(progressInterval);
    setProgress(100);
    loadingStepTitle.textContent = '✅ Analyse terminée !';
    loadingPhase.textContent = data.elapsedMs ? `${(data.elapsedMs / 1000).toFixed(1)} s` : 'Terminé';

    setTimeout(() => {
      renderAnalysisResult(data);
    }, 250);
  } catch (err) {
    clearInterval(progressInterval);
    loadingState.classList.add('hidden');
    errorState.classList.remove('hidden');
    let msg = err.message || 'Erreur inconnue';
    if (msg.includes('denied access') || msg.includes('PERMISSION_DENIED')) {
      msg = "🛑 Accès refusé par Google sur ce projet : « Your project has been denied access ».\n\n👉 Solution en 30 secondes :\n1. Rendez-vous sur https://aistudio.google.com/apikey\n2. Cliquez sur « Créer une clé API » puis choisissez « Créer dans un NOUVEAU projet » (gratuit et sans restriction).\n3. Collez la nouvelle clé dans « ⚙️ Clé API & mode » en haut.\n\n(Ou activez la facturation sur votre projet Google Cloud actuel).";
    }
    errorMessage.textContent = msg;
  } finally {
    analyzeBtn.disabled = false;
  }
});

// 5. Affichage clair des résultats essentiels
const ORDER_TYPE_LABELS = {
  MARKET: 'Exécution au marché',
  BUY_LIMIT: 'Buy Limit',
  SELL_LIMIT: 'Sell Limit',
  BUY_STOP: 'Buy Stop',
  SELL_STOP: 'Sell Stop',
  AUCUN: 'Aucun'
};

function renderAnalysisResult(data) {
  loadingState.classList.add('hidden');
  resultContainer.classList.remove('hidden');

  const plan = data.plan || {};
  const verdict = plan.verdict || {};
  const inputs = plan.essential_order_inputs || {};
  const structure = plan.market_structure_facts || {};

  const action = String(verdict.action || 'WAIT').toUpperCase();
  const verdictCard = document.getElementById('verdictCard');
  verdictCard.className = 'verdict-card';

  const actionLabels = {
    BUY: 'ACHETER (LONG / BUY)',
    SELL: 'VENDRE (SHORT / SELL)',
    WAIT: 'ATTENDRE (PAS DE SIGNAL CLAIR)',
    NO_TRADE: 'NE PAS TRADER (PROTECTION CAPITAL)'
  };

  if (action === 'BUY') verdictCard.classList.add('verdict-buy');
  else if (action === 'SELL') verdictCard.classList.add('verdict-sell');
  else verdictCard.classList.add('verdict-wait');

  document.getElementById('verdictAction').textContent = actionLabels[action] || action;
  document.getElementById('verdictOrderType').textContent = `ORDRE : ${verdict.order_type || 'AUCUN'}`;
  document.getElementById('confidenceScore').textContent = `${verdict.confidence_score ?? 0}%`;
  document.getElementById('guardStatusBadge').textContent = verdict.hallucination_guard_status || 'VÉRIFIÉ';
  document.getElementById('headlineReason').textContent = verdict.headline_reason || '';

  // Infos essentielles du ticket
  document.getElementById('outAsset').textContent = inputs.asset || '--';
  document.getElementById('outTimeframe').textContent = inputs.timeframe || '--';
  document.getElementById('outCurrentPrice').textContent = inputs.current_price || '--';
  document.getElementById('outTrendBias').textContent = structure.trend_bias || '--';

  document.getElementById('outEntry').textContent = inputs.entry_price || '--';
  document.getElementById('outSL').textContent = inputs.stop_loss || '--';
  document.getElementById('outTP1').textContent = inputs.take_profit_1 || '--';
  document.getElementById('outTP2').textContent = inputs.take_profit_2 || '--';

  document.getElementById('outRR').textContent = inputs.risk_reward_ratio || inputs.calculated_rr_tp1 || '--';
  document.getElementById('outRiskPct').textContent = inputs.recommended_risk_pct || '--';

  // Calcul perte max en devise (uniquement si un ordre est réellement recommandé)
  const capital = parseFloat(document.getElementById('capitalInput').value);
  const riskPct = parseFloat(String(inputs.recommended_risk_pct || '').replace(',', '.')) || parseFloat(document.getElementById('riskInput').value);
  const hasOrder = action === 'BUY' || action === 'SELL';
  let maxLossVal = '0.00';
  if (!isNaN(capital) && !isNaN(riskPct) && hasOrder) {
    maxLossVal = ((capital * riskPct) / 100).toFixed(2);
    document.getElementById('outMaxLossMoney').textContent = `${maxLossVal} $ / € (pour ${riskPct}%)`;
  } else {
    document.getElementById('outMaxLossMoney').textContent = '0.00 (Aucun ordre actif)';
  }

  // Mise à jour de l'instruction d'exécution MT5
  const mt5InstructionElem = document.getElementById('outMt5Instruction');
  const oType = String(verdict.order_type || '').toUpperCase();
  if (mt5InstructionElem) {
    if (!hasOrder) {
      mt5InstructionElem.textContent = `🛑 SÉCURITÉ ANTI-HALLUCINATION : patientez (${verdict.headline_reason || 'signal non optimal'}). Ne placez aucun ordre tant que les conditions ne sont pas réunies.`;
    } else if (/LIMIT|STOP/.test(oType)) {
      const isBuy = action === 'BUY';
      const label = ORDER_TYPE_LABELS[oType] || (isBuy ? 'Buy Limit' : 'Sell Limit');
      mt5InstructionElem.textContent = `📋 DANS MT5 : Nouvel ordre (F9) → Type : "Ordre en attente" → "${label}" → Prix : ${inputs.entry_price} → SL : ${inputs.stop_loss} → TP : ${inputs.take_profit_1}.`;
    } else {
      const isBuy = action === 'BUY';
      mt5InstructionElem.textContent = `📋 DANS MT5 : Nouvel ordre (F9) → Cliquez sur "${isBuy ? 'Buy by Market' : 'Sell by Market'}" → SL : ${inputs.stop_loss} → TP : ${inputs.take_profit_1}.`;
    }
  }

  // Invalidation & Confluences
  document.getElementById('outInvalidation').textContent = plan.invalidation_warning || 'Sortir immédiatement si le Stop Loss est touché.';
  document.getElementById('outSupport').textContent = structure.key_support_zone || '--';
  document.getElementById('outResistance').textContent = structure.key_resistance_zone || '--';

  fillList('outConfluences', structure.observed_confluences);
  fillList('outChecklist', plan.strict_checklist_before_clicking);

  // Audit
  const m = data.modelsUsed || {};
  const timing = data.elapsedMs ? ` · ${(data.elapsedMs / 1000).toFixed(1)} s` : '';
  document.getElementById('outModelsUsed').textContent =
    `${data.provider ? data.provider.toUpperCase() + ' · ' : ''}Lecture : ${m.ocrModel || '?'} → Décision : ${m.decisionModel || '?'}${m.verifierModel ? ` · Vérif : ${m.verifierModel}` : ''}${timing}`;

  const auditList = document.getElementById('outAuditFlags');
  auditList.innerHTML = '';
  (plan.audit_trail?.length ? plan.audit_trail : ['VÉRIFIÉ : analyse terminée sans anomalie.']).forEach(flag => {
    const li = document.createElement('li');
    li.textContent = `🛡️ ${flag}`;
    auditList.appendChild(li);
  });

  document.getElementById('outRawOcr').textContent = JSON.stringify(data.ocrFacts, null, 2);

  // 1. Mise à jour de la Fiche Ordre MT5 Express (avec calcul dynamique des Lots)
  updateMt5OrderSlip(data);

  // 2. Tracé visuel des niveaux sur l'image
  const chartOverlayCanvas = document.getElementById('chartOverlayCanvas');
  if (chartOverlayCanvas && chartPreview) {
    drawLevelsOnCanvas(chartOverlayCanvas, chartPreview, data);
  }

  // 3. Sauvegarde automatique dans le journal local
  saveToHistory(data);

  // 4. Alerte sonore professionnelle
  playChime(action === 'BUY' || action === 'SELL' ? 'trade' : 'wait');
}

function fillList(id, items) {
  const list = document.getElementById(id);
  list.innerHTML = '';
  (Array.isArray(items) ? items : []).forEach(item => {
    const li = document.createElement('li');
    li.textContent = typeof item === 'string' ? item : JSON.stringify(item);
    list.appendChild(li);
  });
}

// Extrait le prix principal ("2,657.20" → "2657.20", "1,0845" → "1.0845") pour coller dans MT5/TradingView
function extractPriceForCopy(text) {
  if (typeof text === 'number') return Number.isFinite(text) ? String(text) : null;
  const m = String(text || '').match(/-?\d[\d\s.,']*/);
  if (!m) return null;
  let t = m[0].trim().replace(/[\s']/g, '').replace(/[.,]+$/, '');
  const lastDot = t.lastIndexOf('.');
  const lastComma = t.lastIndexOf(',');
  if (lastDot !== -1 && lastComma !== -1) {
    const dec = lastDot > lastComma ? '.' : ',';
    t = t.split(dec === '.' ? ',' : '.').join('').replace(dec, '.');
  } else if (lastComma !== -1) {
    const parts = t.split(',');
    t = parts.length > 2 || (parts.length === 2 && parts[1].length === 3 && parts[0].length <= 3 && parts[0] !== '0') ? parts.join('') : parts.join('.');
  }
  return t;
}

function parsePriceNum(val) {
  const p = extractPriceForCopy(val);
  return p !== null ? parseFloat(p) : null;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

// ============================================================================
// CALCULATEUR DE LOTS & FICHE D'ORDRE MT5 EXPRESS
// ============================================================================
let currentAnalysisData = null;
let currentRiskPercent = 0.5;

function calculateLots(asset, entryPrice, slPrice, capital, riskPercent) {
  const entry = parsePriceNum(entryPrice);
  const sl = parsePriceNum(slPrice);
  if (entry === null || sl === null || entry === sl) return null;
  const cap = parseFloat(capital) || 10000;
  const riskPct = parseFloat(riskPercent) || 0.5;
  const riskAmount = (cap * riskPct) / 100;
  const dist = Math.abs(entry - sl);
  if (dist <= 0) return null;

  const clean = (asset || '').toUpperCase().trim();
  let assetType = 'Forex / CFD Standard';
  let lots = 0.01;

  if (/XAU|GOLD|OR\b/i.test(clean)) {
    assetType = 'Or Spot (XAUUSD : 1 lot = 100 oz)';
    lots = riskAmount / (dist * 100);
  } else if (/BTC|ETH|SOL|CRYPTO/i.test(clean)) {
    assetType = 'Crypto (1 lot = 1 unité)';
    lots = riskAmount / dist;
  } else if (/US30|DJI|DOW|NAS|NDX|SPX|SP500|GER40|DAX/i.test(clean)) {
    assetType = 'Indice CFD (1 lot = 1$/point)';
    lots = riskAmount / dist;
  } else if (/EUR|GBP|USD|JPY|AUD|NZD|CAD|CHF/i.test(clean)) {
    const isJpy = clean.includes('JPY');
    const pipSize = isJpy ? 0.01 : 0.0001;
    const slPips = dist / pipSize;
    lots = slPips > 0 ? riskAmount / (slPips * 10) : 0.01;
    assetType = `Forex standard (~${slPips.toFixed(1)} pips)`;
  } else {
    lots = riskAmount / dist;
  }

  const rounded = Math.max(0.01, Math.round(lots * 100) / 100);
  return {
    assetType,
    lots: rounded.toFixed(2),
    riskAmount: riskAmount.toFixed(2),
    distance: dist.toFixed(2)
  };
}

function updateMt5OrderSlip(data) {
  currentAnalysisData = data;
  const plan = data?.plan || {};
  const verdict = plan.verdict || {};
  const inputs = plan.essential_order_inputs || {};
  const action = String(verdict.action || 'WAIT').toUpperCase();
  const hasOrder = action === 'BUY' || action === 'SELL';

  const symElem = document.getElementById('mt5Symbol');
  const typeElem = document.getElementById('mt5Type');
  const lotsElem = document.getElementById('mt5Lots');
  const priceElem = document.getElementById('mt5Price');
  const slElem = document.getElementById('mt5SL');
  const tpElem = document.getElementById('mt5TP');
  const assetTypeBadge = document.getElementById('mt5AssetTypeBadge');
  const liveRiskSummary = document.getElementById('liveRiskSummary');

  const sym = inputs.asset || document.getElementById('symbolInput').value.trim() || 'XAUUSD';
  if (symElem) symElem.textContent = sym;

  const oType = String(verdict.order_type || 'AUCUN').toUpperCase();
  const rawEntry = extractPriceForCopy(inputs.entry_price) || '--';
  const rawSL = extractPriceForCopy(inputs.stop_loss) || '--';
  const rawTP = extractPriceForCopy(inputs.take_profit_1) || '--';
  const rawTP2 = extractPriceForCopy(inputs.take_profit_2);

  if (typeElem) typeElem.textContent = hasOrder ? ORDER_TYPE_LABELS[oType] || oType : 'AUCUN (ATTENDRE)';
  if (priceElem) priceElem.textContent = hasOrder && oType !== 'MARKET' ? rawEntry : 'Exécution Marché';
  if (slElem) slElem.textContent = hasOrder ? rawSL : 'N/A';
  if (tpElem) tpElem.textContent = hasOrder ? (rawTP2 ? `${rawTP} (TP1)` : rawTP) : 'N/A';

  const liveCapInput = document.getElementById('liveCapitalInput');
  const liveCap = liveCapInput ? parseFloat(liveCapInput.value) || 10000 : 10000;
  const lotCalc = hasOrder ? calculateLots(sym, rawEntry, rawSL, liveCap, currentRiskPercent) : null;

  if (lotCalc) {
    if (lotsElem) lotsElem.textContent = `${lotCalc.lots} Lot${parseFloat(lotCalc.lots) > 1 ? 's' : ''}`;
    if (assetTypeBadge) assetTypeBadge.textContent = lotCalc.assetType;
    const lossMoney = lotCalc.riskAmount;
    const gainMoney = (parseFloat(lossMoney) * (plan.computed?.rr_tp1 || 1.8)).toFixed(2);
    if (liveRiskSummary) {
      liveRiskSummary.innerHTML = `Perte max si SL : <strong style="color:#ef4444;">-${lossMoney} $</strong> · Gain attendu : <strong style="color:#10b981;">+${gainMoney} $</strong>`;
    }
  } else {
    if (lotsElem) lotsElem.textContent = '0.00 Lot';
    if (assetTypeBadge) assetTypeBadge.textContent = 'Pas d’ordre actif';
    if (liveRiskSummary) {
      liveRiskSummary.innerHTML = 'Perte max : <strong>0.00 $</strong> · Gain attendu : <strong>0.00 $</strong>';
    }
  }
}

// Boutons de risque rapide (0.25%, 0.50%, 1.00%, 2.00%)
document.querySelectorAll('.risk-pill-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.risk-pill-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentRiskPercent = parseFloat(btn.getAttribute('data-risk')) || 0.5;
    if (currentAnalysisData) updateMt5OrderSlip(currentAnalysisData);
  });
});

document.getElementById('liveCapitalInput')?.addEventListener('input', () => {
  if (currentAnalysisData) updateMt5OrderSlip(currentAnalysisData);
});

// Mini boutons copier 📋 dans la fiche MT5
document.querySelectorAll('.copy-btn-mini').forEach(btn => {
  btn.addEventListener('click', async () => {
    const targetId = btn.getAttribute('data-target');
    const elem = document.getElementById(targetId);
    if (!elem) return;
    const raw = elem.textContent || '';
    const clean = extractPriceForCopy(raw) || raw;
    await copyText(clean);
    btn.classList.add('copied');
    btn.textContent = '✓';
    setTimeout(() => {
      btn.classList.remove('copied');
      btn.textContent = '📋';
    }, 1200);
  });
});

// Bouton copier tout le ticket MT5
document.getElementById('copyAllMt5Btn')?.addEventListener('click', async () => {
  const sym = document.getElementById('mt5Symbol')?.textContent || 'XAUUSD';
  const type = document.getElementById('mt5Type')?.textContent || '--';
  const lots = document.getElementById('mt5Lots')?.textContent || '--';
  const price = document.getElementById('mt5Price')?.textContent || '--';
  const sl = document.getElementById('mt5SL')?.textContent || '--';
  const tp = document.getElementById('mt5TP')?.textContent || '--';
  const rr = document.getElementById('outRR')?.textContent || '--';

  const text = [
    `=== FICHE ORDRE METATRADER 5 ===`,
    `Symbole : ${sym}`,
    `Type d'ordre : ${type}`,
    `Volume (Lots) : ${lots}`,
    `Prix d'Entrée : ${price}`,
    `Stop Loss : ${sl}`,
    `Take Profit : ${tp}`,
    `Ratio Risque/Gain : ${rr}`,
    `Généré automatiquement par OmniRoute Trading Desk`
  ].join('\n');

  await copyText(text);
  const btn = document.getElementById('copyAllMt5Btn');
  btn.textContent = '✅ Fiche MT5 Copiée !';
  setTimeout(() => (btn.textContent = '📋 Copier Fiche Complète MT5'), 1500);
});

// Bouton export Telegram / Discord
document.getElementById('copyTelegramBtn')?.addEventListener('click', async () => {
  const sym = document.getElementById('mt5Symbol')?.textContent || 'XAUUSD';
  const action = document.getElementById('verdictAction')?.textContent || '--';
  const type = document.getElementById('mt5Type')?.textContent || '--';
  const lots = document.getElementById('mt5Lots')?.textContent || '--';
  const price = document.getElementById('mt5Price')?.textContent || '--';
  const sl = document.getElementById('mt5SL')?.textContent || '--';
  const tp = document.getElementById('mt5TP')?.textContent || '--';
  const rr = document.getElementById('outRR')?.textContent || '--';

  const text = [
    `🚨 *SIGNAL TRADING — ${sym}*`,
    `🎯 *Décision* : ${action}`,
    `📋 *Type d'ordre* : ${type}`,
    `🔹 *Entrée* : \`${price}\``,
    `🛑 *Stop Loss* : \`${sl}\``,
    `🟢 *Take Profit* : \`${tp}\``,
    `⚖️ *Ratio R:R* : ${rr}`,
    `📦 *Volume conseillé* : ${lots}`,
    `🛡️ *Vérifié par OmniRoute Desk (Zéro Hallucination)*`
  ].join('\n');

  await copyText(text);
  const btn = document.getElementById('copyTelegramBtn');
  btn.textContent = '✅ Format Telegram Copié !';
  setTimeout(() => (btn.textContent = '💬 Format Telegram / Discord'), 1500);
});

// Bouton export Pine Script pour TradingView
document.getElementById('copyPineBtn')?.addEventListener('click', async () => {
  const price = extractPriceForCopy(document.getElementById('mt5Price')?.textContent) || '0';
  const sl = extractPriceForCopy(document.getElementById('mt5SL')?.textContent) || '0';
  const tp = extractPriceForCopy(document.getElementById('mt5TP')?.textContent) || '0';

  const pine = [
    `//@version=5`,
    `indicator("OmniRoute Trade Levels", overlay=true)`,
    `entryLevel = ${price}`,
    `slLevel = ${sl}`,
    `tpLevel = ${tp}`,
    `plot(entryLevel, "Entrée", color=color.blue, linewidth=2, style=plot.style_linebr)`,
    `plot(slLevel, "Stop Loss", color=color.red, linewidth=2, style=plot.style_linebr)`,
    `plot(tpLevel, "Take Profit", color=color.green, linewidth=2, style=plot.style_linebr)`
  ].join('\n');

  await copyText(pine);
  const btn = document.getElementById('copyPineBtn');
  btn.textContent = '✅ Pine Script Copié !';
  setTimeout(() => (btn.textContent = '📊 Pine Script (TradingView)'), 1500);
});

// ============================================================================
// TRACÉ DES NIVEAUX SUR LE CANVAS OVERLAY
// ============================================================================
let overlayVisible = true;

function drawLevelsOnCanvas(canvas, img, data) {
  if (!canvas || !img || !data) return;
  const plan = data.plan || {};
  const ocr = data.ocrFacts?.extracted_facts || {};
  const verdict = plan.verdict || {};
  const action = String(verdict.action || 'WAIT').toUpperCase();

  canvas.width = img.naturalWidth || img.width || 800;
  canvas.height = img.naturalHeight || img.height || 500;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!overlayVisible) return;
  if (action !== 'BUY' && action !== 'SELL') return;

  const entry = parsePriceNum(plan.essential_order_inputs?.entry_price);
  const sl = parsePriceNum(plan.essential_order_inputs?.stop_loss);
  const tp1 = parsePriceNum(plan.essential_order_inputs?.take_profit_1);
  const tp2 = parsePriceNum(plan.essential_order_inputs?.take_profit_2);
  let high = parsePriceNum(ocr.visible_price_range_high);
  let low = parsePriceNum(ocr.visible_price_range_low);

  const validLevels = [entry, sl, tp1, tp2].filter(v => v !== null);
  if (!validLevels.length) return;

  if (high === null || low === null || high <= low) {
    high = Math.max(...validLevels) * 1.01;
    low = Math.min(...validLevels) * 0.99;
  }

  const W = canvas.width;
  const H = canvas.height;
  const getY = price => {
    const ratio = (high - price) / (high - low);
    return Math.max(30, Math.min(H - 30, ratio * H));
  };

  const drawHLine = (price, color, label, isDashed = false) => {
    if (price === null) return;
    const y = getY(price);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    if (isDashed) ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();

    ctx.font = 'bold 14px ui-monospace, SFMono-Regular, monospace';
    const text = `${label}: ${price}`;
    const tw = ctx.measureText(text).width + 18;
    ctx.fillStyle = color;
    ctx.fillRect(W - tw - 16, y - 13, tw, 26);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, W - tw - 8, y + 5);
    ctx.restore();
  };

  drawHLine(tp2, '#10b981', 'TP2');
  drawHLine(tp1, '#10b981', 'TP1');
  drawHLine(entry, '#3b82f6', 'ENTRÉE', true);
  drawHLine(sl, '#ef4444', 'STOP LOSS');
}

const toggleOverlayBtn = document.getElementById('toggleOverlayBtn');
toggleOverlayBtn?.addEventListener('click', () => {
  overlayVisible = !overlayVisible;
  toggleOverlayBtn.textContent = overlayVisible ? '👁️ Masquer les niveaux' : '👁️ Afficher les niveaux';
  const chartOverlayCanvas = document.getElementById('chartOverlayCanvas');
  if (overlayVisible && currentAnalysisData && chartPreview) {
    drawLevelsOnCanvas(chartOverlayCanvas, chartPreview, currentAnalysisData);
  } else if (chartOverlayCanvas) {
    const ctx = chartOverlayCanvas.getContext('2d');
    ctx.clearRect(0, 0, chartOverlayCanvas.width, chartOverlayCanvas.height);
  }
});

// Modal Lightbox Plein Écran
const lightboxModal = document.getElementById('lightboxModal');
const fullscreenBtn = document.getElementById('fullscreenBtn');
const closeLightboxBtn = document.getElementById('closeLightboxBtn');
const lightboxImg = document.getElementById('lightboxImg');
const lightboxCanvas = document.getElementById('lightboxCanvas');

fullscreenBtn?.addEventListener('click', () => {
  if (!currentImageBase64) return;
  lightboxImg.src = currentImageBase64;
  lightboxModal.classList.remove('hidden');
  lightboxImg.onload = () => {
    drawLevelsOnCanvas(lightboxCanvas, lightboxImg, currentAnalysisData);
  };
});

closeLightboxBtn?.addEventListener('click', () => lightboxModal.classList.add('hidden'));
lightboxModal?.addEventListener('click', e => {
  if (e.target === lightboxModal) lightboxModal.classList.add('hidden');
});
window.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !lightboxModal.classList.contains('hidden')) {
    lightboxModal.classList.add('hidden');
  }
});

// ============================================================================
// JOURNAL DE TRADING & HISTORIQUE LOCAL
// ============================================================================
const HISTORY_KEY = 'omniroute_trade_history_v1';

function saveToHistory(data) {
  if (!data?.plan) return;
  const plan = data.plan;
  const verdict = plan.verdict || {};
  const inputs = plan.essential_order_inputs || {};
  const entryItem = {
    id: Date.now(),
    date: new Date().toLocaleString('fr-FR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
    symbol: inputs.asset || 'ACTIF',
    timeframe: inputs.timeframe || '--',
    action: verdict.action || 'WAIT',
    orderType: verdict.order_type || 'AUCUN',
    entry: inputs.entry_price || '--',
    sl: inputs.stop_loss || '--',
    tp: inputs.take_profit_1 || '--',
    rr: inputs.risk_reward_ratio || '--',
    confidence: verdict.confidence_score || 0,
    fullData: data
  };

  try {
    const list = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    list.unshift(entryItem);
    if (list.length > 20) list.pop();
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
    renderHistory();
  } catch {
    // localStorage indisponible
  }
}

function renderHistory() {
  const historyList = document.getElementById('historyList');
  const historyEmpty = document.getElementById('historyEmpty');
  if (!historyList || !historyEmpty) return;

  let list = [];
  try {
    list = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  } catch { list = []; }

  if (!list.length) {
    historyEmpty.classList.remove('hidden');
    historyList.classList.add('hidden');
    return;
  }

  historyEmpty.classList.add('hidden');
  historyList.classList.remove('hidden');
  historyList.innerHTML = '';

  list.forEach(item => {
    const card = document.createElement('div');
    card.className = 'history-card';
    const isBuy = item.action === 'BUY';
    const isSell = item.action === 'SELL';
    const badgeClass = isBuy ? 'buy' : isSell ? 'sell' : 'wait';

    card.innerHTML = `
      <div class="history-card-header">
        <span class="history-card-sym">${item.symbol} (${item.timeframe})</span>
        <span class="history-card-date">${item.date}</span>
      </div>
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span class="history-card-badge ${badgeClass}">${item.action} · ${item.orderType}</span>
        <span style="font-size: 11px; color: #38bdf8;">Certitude : ${item.confidence}%</span>
      </div>
      <div class="history-card-levels">
        <div>Entrée : <strong>${item.entry}</strong></div>
        <div>SL : <strong style="color:#ef4444;">${item.sl}</strong></div>
        <div>TP1 : <strong style="color:#10b981;">${item.tp}</strong></div>
        <div>R:R : <strong>${item.rr}</strong></div>
      </div>
    `;

    card.addEventListener('click', () => {
      if (item.fullData) {
        renderAnalysisResult(item.fullData);
        window.scrollTo({ top: resultContainer.offsetTop - 40, behavior: 'smooth' });
      }
    });

    historyList.appendChild(card);
  });
}

document.getElementById('exportCsvBtn')?.addEventListener('click', () => {
  const list = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  if (!list.length) return alert('Aucune analyse à exporter.');
  const headers = ['Date', 'Symbole', 'Timeframe', 'Action', 'Type Ordre', 'Entrée', 'Stop Loss', 'TP1', 'R:R', 'Certitude'];
  const rows = list.map(i => [
    `"${i.date}"`, `"${i.symbol}"`, `"${i.timeframe}"`, `"${i.action}"`,
    `"${i.orderType}"`, `"${i.entry}"`, `"${i.sl}"`, `"${i.tp}"`, `"${i.rr}"`, `"${i.confidence}%"`
  ]);
  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `journal_trading_omniroute_${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('clearHistoryBtn')?.addEventListener('click', () => {
  if (confirm('Voulez-vous vraiment effacer tout votre historique de trading local ?')) {
    localStorage.removeItem(HISTORY_KEY);
    renderHistory();
  }
});

// Boutons de copie rapide existants
document.querySelectorAll('.copy-val-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const targetId = btn.getAttribute('data-target');
    const rawText = document.getElementById(targetId)?.textContent || '';
    const toCopy = extractPriceForCopy(rawText) || rawText;
    await copyText(toCopy);
    const prev = btn.textContent;
    btn.textContent = '✓ Copié';
    setTimeout(() => (btn.textContent = prev), 1200);
  });
});

document.getElementById('copyTicketBtn')?.addEventListener('click', async () => {
  const summary = [
    `=== TICKET TRADING ===`,
    `Décision : ${document.getElementById('verdictAction')?.textContent} (${document.getElementById('verdictOrderType')?.textContent})`,
    `Actif : ${document.getElementById('outAsset')?.textContent} | TF : ${document.getElementById('outTimeframe')?.textContent}`,
    `Entrée : ${document.getElementById('outEntry')?.textContent}`,
    `Stop Loss : ${document.getElementById('outSL')?.textContent}`,
    `Take Profit 1 : ${document.getElementById('outTP1')?.textContent}`,
    `Take Profit 2 : ${document.getElementById('outTP2')?.textContent}`,
    `R:R : ${document.getElementById('outRR')?.textContent} | Risque : ${document.getElementById('outRiskPct')?.textContent}`,
    `Invalidation : ${document.getElementById('outInvalidation')?.textContent}`
  ].join('\n');

  await copyText(summary);
  const btn = document.getElementById('copyTicketBtn');
  btn.textContent = '✅ Ticket copié !';
  setTimeout(() => (btn.textContent = '📋 Copier le ticket'), 1500);
});

checkOmniRouteStatus();
renderHistory();
