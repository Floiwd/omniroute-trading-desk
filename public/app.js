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

// Sauvegarde/restauration des préférences dans le navigateur (utile sur Vercel)
customApiKeyInput.value = localStorage.getItem('omniroute_api_key') || '';
customApiKeyInput.addEventListener('input', e => {
  localStorage.setItem('omniroute_api_key', e.target.value.trim());
});
const savedMode = localStorage.getItem('analysis_mode');
if (savedMode && [...analysisModeSelect.options].some(o => o.value === savedMode)) analysisModeSelect.value = savedMode;
analysisModeSelect.addEventListener('change', () => localStorage.setItem('analysis_mode', analysisModeSelect.value));

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
  } catch {
    // Ignorer si l'API serveur ne répond pas
  }

  const userKey = customApiKeyInput.value.trim();
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
    const payload = {
      imageBase64: currentImageBase64,
      customApiKey: customApiKeyInput.value.trim(),
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
      // Depuis Vercel sans clé serveur : bascule en appel direct navigateur -> OmniRoute local du Mac
      const noServerKey = !res || res.status === 401 || res.status === 404;
      if (!IS_LOCAL && noServerKey && !/^(AIza|AQ\.)/.test(payload.customApiKey)) {
        data = await runDirectBrowserOmniRouteAnalysis(payload);
      } else {
        throw new Error(data.error || 'Erreur inconnue');
      }
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
    errorMessage.textContent = err.message;
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

  // Remplissage du Guide MT5 Pas à Pas
  const mt5OrderTypeElem = document.getElementById('outMt5OrderType');
  const mt5ActionElem = document.getElementById('outMt5Action');
  const mt5VolumeElem = document.getElementById('outMt5Volume');
  const mt5InstructionElem = document.getElementById('outMt5Instruction');

  const oType = String(verdict.order_type || '').toUpperCase();
  const slDist = plan.computed?.sl_distance;
  const volumeText = `Risque : ${riskPct}% (~${maxLossVal} $ / € max)${slDist ? ` · distance SL ${slDist}` : ''}`;

  if (!hasOrder) {
    mt5OrderTypeElem.textContent = 'AUCUN ORDRE (ATTENDRE)';
    mt5ActionElem.textContent = 'NE RIEN FAIRE SUR MT5';
    mt5VolumeElem.textContent = 'Lot = 0 (Pas de risque)';
    mt5InstructionElem.textContent = `🛑 SÉCURITÉ ANTI-HALLUCINATION : patientez (${verdict.headline_reason || 'signal non optimal'}). Ne placez aucun ordre tant que les conditions ne sont pas réunies.`;
  } else if (/LIMIT|STOP/.test(oType)) {
    const isBuy = action === 'BUY';
    const label = ORDER_TYPE_LABELS[oType] || (isBuy ? 'Buy Limit' : 'Sell Limit');
    mt5OrderTypeElem.textContent = `${label} (Ordre en attente)`;
    mt5ActionElem.textContent = oType.includes('STOP')
      ? (isBuy ? 'ACHAT SUR CASSURE' : 'VENTE SUR CASSURE')
      : (isBuy ? 'ACHAT SUR REPLI' : 'VENTE SUR REBOND');
    mt5VolumeElem.textContent = volumeText;
    mt5InstructionElem.textContent = `📋 DANS MT5 : Nouvel ordre → Type : "Ordre en attente" → "${label}" → Prix : ${inputs.entry_price} → SL : ${inputs.stop_loss} → TP : ${inputs.take_profit_1}.`;
  } else {
    const isBuy = action === 'BUY';
    mt5OrderTypeElem.textContent = isBuy ? 'Exécution instantanée (Buy Market)' : 'Exécution instantanée (Sell Market)';
    mt5ActionElem.textContent = isBuy ? 'ACHETER DIRECT' : 'VENDRE DIRECT';
    mt5VolumeElem.textContent = volumeText;
    mt5InstructionElem.textContent = `📋 DANS MT5 : Cliquez sur "${isBuy ? 'Buy by Market' : 'Sell by Market'}" → SL : ${inputs.stop_loss} → TP : ${inputs.take_profit_1}.`;
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
  const m = String(text).match(/-?\d[\d\s.,']*/);
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

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Repli pour les contextes non sécurisés (http non-localhost)
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

// Boutons de copie rapide des niveaux
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

document.getElementById('copyTicketBtn').addEventListener('click', async () => {
  const summary = [
    `=== TICKET TRADING ===`,
    `Décision : ${document.getElementById('verdictAction').textContent} (${document.getElementById('verdictOrderType').textContent})`,
    `Actif : ${document.getElementById('outAsset').textContent} | TF : ${document.getElementById('outTimeframe').textContent}`,
    `Entrée : ${document.getElementById('outEntry').textContent}`,
    `Stop Loss : ${document.getElementById('outSL').textContent}`,
    `Take Profit 1 : ${document.getElementById('outTP1').textContent}`,
    `Take Profit 2 : ${document.getElementById('outTP2').textContent}`,
    `R:R : ${document.getElementById('outRR').textContent} | Risque : ${document.getElementById('outRiskPct').textContent}`,
    `Invalidation : ${document.getElementById('outInvalidation').textContent}`
  ].join('\n');

  await copyText(summary);
  const btn = document.getElementById('copyTicketBtn');
  btn.textContent = '✅ Ticket copié !';
  setTimeout(() => (btn.textContent = '📋 Copier le ticket'), 1500);
});

// Mode Direct Navigateur -> OmniRoute Local (lorsque le site est ouvert depuis l'URL Vercel sans clé serveur)
// Passe unique combinée ; le contrôle mathématique strict reste effectué côté serveur quand il est disponible.
async function runDirectBrowserOmniRouteAnalysis(payload) {
  const apiKey = (payload.customApiKey || '').trim();
  if (!apiKey) {
    apiConfigDrawer.classList.remove('hidden');
    throw new Error(
      "Aucune clé côté serveur. Collez une clé Gemini (AIza…) ou OmniRoute dans « ⚙️ Clé API & mode » (sauvegardée dans votre navigateur), ou ajoutez GEMINI_API_KEY dans les variables Vercel."
    );
  }

  const model = payload.preferredModel && payload.preferredModel !== 'auto' ? payload.preferredModel : 'gemini/gemini-3.8-flash@low';
  const [modelId, effort] = model.split('@');
  const parseJson = txt => {
    const m = txt.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const clean = m ? m[1].trim() : txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1);
    return JSON.parse(clean);
  };

  const started = Date.now();
  const body = {
    model: modelId,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Tu es un gestionnaire de risque Zéro Hallucination. Lis UNIQUEMENT les faits visibles (axe des prix caractère par caractère), n'invente aucun prix, puis donne le plan. Contexte : Actif=${payload.symbol || 'non précisé'}, TF=${payload.timeframe || 'non précisé'}, Capital=${payload.capital}, Risque=${payload.riskPercent}%, Notes=${payload.notes || 'aucune'}. Si incertain ou R:R < 1.8 : WAIT ou NO_TRADE. BUY : SL < Entrée < TP1 < TP2. SELL : SL > Entrée > TP1 > TP2. Prix = nombres seuls. Réponds uniquement en JSON : {"ocr_facts":{"image_quality":{"is_trading_chart":true,"price_axis_readable":true,"visibility_score_0_to_100":90},"extracted_facts":{"symbol_on_chart":"...","timeframe_on_chart":"...","current_price_on_chart":"..."}},"plan":{"verdict":{"action":"BUY|SELL|WAIT|NO_TRADE","order_type":"MARKET|BUY_LIMIT|SELL_LIMIT|BUY_STOP|SELL_STOP|AUCUN","confidence_score":0,"hallucination_guard_status":"SAFE_VERIFIED","headline_reason":"..."},"essential_order_inputs":{"asset":"...","timeframe":"...","current_price":"...","entry_price":"...","stop_loss":"...","take_profit_1":"...","take_profit_2":"...","risk_reward_ratio":"...","recommended_risk_pct":"..."},"market_structure_facts":{"trend_bias":"...","key_support_zone":"...","key_resistance_zone":"...","observed_confluences":["..."]},"strict_checklist_before_clicking":["..."],"invalidation_warning":"..."}}`
          },
          { type: 'image_url', image_url: { url: payload.imageBase64 } }
        ]
      }
    ]
  };
  if (effort) body.reasoning_effort = effort;

  const res = await fetch(`${LOCAL_OMNIROUTE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000)
  });
  const json = await readJsonResponse(res);
  if (!res.ok || json.error) {
    throw new Error(json.error?.message || json.error || 'Erreur OmniRoute local');
  }
  const parsed = parseJson(json.choices?.[0]?.message?.content || '');
  const plan = parsed.plan || {};
  plan.audit_trail = [
    'MODE DIRECT NAVIGATEUR : contrôle mathématique serveur indisponible — vérifiez vous-même SL / Entrée / TP avant d\'exécuter.'
  ];

  return {
    success: true,
    provider: 'omniroute (direct)',
    elapsedMs: Date.now() - started,
    modelsUsed: { ocrModel: json.model || modelId, decisionModel: json.model || modelId },
    ocrFacts: parsed.ocr_facts || {},
    plan
  };
}

checkOmniRouteStatus();
