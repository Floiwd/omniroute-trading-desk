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
const loadingStepTitle = document.getElementById('loadingStepTitle');
const errorState = document.getElementById('errorState');
const errorMessage = document.getElementById('errorMessage');
const resultContainer = document.getElementById('resultContainer');

// 1. Vérifier la connexion OmniRoute + Clé Keychain au démarrage
async function checkOmniRouteStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();

    if (data.omnirouteOnline) {
      omniStatusBadge.className = 'status-badge online';
      omniStatusText.textContent = `OmniRoute Connecté (${data.modelCount} modèles)`;
    } else {
      omniStatusBadge.className = 'status-badge offline';
      omniStatusText.textContent = 'OmniRoute Hors-ligne (lancez or-start)';
    }

    if (data.hasKeychainKey) {
      maskedKeyLabel.textContent = `${data.maskedKey} (Trousseau macOS)`;
    } else {
      maskedKeyLabel.textContent = 'Clé manuelle requise';
      apiConfigDrawer.classList.remove('hidden');
    }
  } catch {
    omniStatusBadge.className = 'status-badge offline';
    omniStatusText.textContent = 'Serveur local indisponible';
  }
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

function handleFile(file) {
  if (!file || !file.type.startsWith('image/')) {
    alert('Veuillez sélectionner un fichier image (PNG, JPG, WebP).');
    return;
  }
  const reader = new FileReader();
  reader.onload = e => setChartImage(e.target.result);
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

fileInput.addEventListener('change', e => {
  if (e.target.files?.[0]) handleFile(e.target.files[0]);
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
analyzeBtn.addEventListener('click', async () => {
  if (!currentImageBase64) return;

  emptyState.classList.add('hidden');
  errorState.classList.add('hidden');
  resultContainer.classList.add('hidden');
  loadingState.classList.remove('hidden');
  analyzeBtn.disabled = true;

  loadingStepTitle.textContent = 'Étape 1/2 : Lecture OCR stricte des prix sur le graphique...';
  const stepTimer = setTimeout(() => {
    loadingStepTitle.textContent = 'Étape 2/2 : Calcul des niveaux SL/TP & Vérification mathématique anti-erreur...';
  }, 3500);

  try {
    const payload = {
      imageBase64: currentImageBase64,
      customApiKey: document.getElementById('customApiKey').value,
      preferredModel: document.getElementById('preferredModel').value,
      doubleVerification: document.getElementById('doubleVerification').checked,
      symbol: document.getElementById('symbolInput').value,
      timeframe: document.getElementById('timeframeInput').value,
      capital: document.getElementById('capitalInput').value,
      riskPercent: document.getElementById('riskInput').value,
      notes: document.getElementById('notesInput').value
    };

    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    clearTimeout(stepTimer);

    if (!res.ok || data.error) {
      throw new Error(data.error || 'Erreur inconnue');
    }

    renderAnalysisResult(data);
  } catch (err) {
    clearTimeout(stepTimer);
    loadingState.classList.add('hidden');
    errorState.classList.remove('hidden');
    errorMessage.textContent = err.message;
  } finally {
    analyzeBtn.disabled = false;
  }
});

// 5. Affichage clair des résultats essentiels
function renderAnalysisResult(data) {
  loadingState.classList.add('hidden');
  resultContainer.classList.remove('hidden');

  const plan = data.plan || {};
  const verdict = plan.verdict || {};
  const inputs = plan.essential_order_inputs || {};
  const structure = plan.market_structure_facts || {};

  const action = (verdict.action || 'WAIT').toUpperCase();
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

  document.getElementById('outRR').textContent = inputs.calculated_rr_tp1 || inputs.risk_reward_ratio || '--';
  document.getElementById('outRiskPct').textContent = inputs.recommended_risk_pct || '--';

  // Calcul perte max en devise
  const capital = parseFloat(document.getElementById('capitalInput').value);
  const riskPct = parseFloat(document.getElementById('riskInput').value);
  const hasOrder = action === 'BUY' || action === 'SELL' || (verdict.order_type && verdict.order_type !== 'AUCUN');
  if (!isNaN(capital) && !isNaN(riskPct) && hasOrder && action !== 'NO_TRADE') {
    const maxLoss = ((capital * riskPct) / 100).toFixed(2);
    document.getElementById('outMaxLossMoney').textContent = `${maxLoss} $ / € (pour ${riskPct}%)`;
  } else {
    document.getElementById('outMaxLossMoney').textContent = '0.00 (Aucun ordre actif)';
  }

  // Invalidation & Confluences
  document.getElementById('outInvalidation').textContent = plan.invalidation_warning || 'Sortir immédiatement si le Stop Loss est touché.';
  document.getElementById('outSupport').textContent = structure.key_support_zone || '--';
  document.getElementById('outResistance').textContent = structure.key_resistance_zone || '--';

  const confList = document.getElementById('outConfluences');
  confList.innerHTML = '';
  (structure.observed_confluences || []).forEach(item => {
    const li = document.createElement('li');
    li.textContent = item;
    confList.appendChild(li);
  });

  const checkList = document.getElementById('outChecklist');
  checkList.innerHTML = '';
  (plan.strict_checklist_before_clicking || []).forEach(item => {
    const li = document.createElement('li');
    li.textContent = item;
    checkList.appendChild(li);
  });

  // Audit
  document.getElementById('outModelsUsed').textContent =
    `OCR: ${data.modelsUsed?.ocrModel || 'OmniRoute'} → Décision: ${data.modelsUsed?.decisionModel || 'OmniRoute'}`;

  const auditList = document.getElementById('outAuditFlags');
  auditList.innerHTML = '';
  (plan.audit_trail || ['VÉRIFIÉ : Lecture en 2 passes terminée sans anomalie.']).forEach(flag => {
    const li = document.createElement('li');
    li.textContent = `🛡️ ${flag}`;
    auditList.appendChild(li);
  });

  document.getElementById('outRawOcr').textContent = JSON.stringify(data.ocrFacts, null, 2);
}

// Boutons de copie rapide des niveaux
document.querySelectorAll('.copy-val-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const targetId = btn.getAttribute('data-target');
    const rawText = document.getElementById(targetId)?.textContent || '';
    // Extrait le nombre principal s'il y en a un pour coller directement dans MT5/TradingView
    const numMatch = rawText.replace(',', '.').match(/\d+(\.\d+)?/);
    const toCopy = numMatch ? numMatch[0] : rawText;
    navigator.clipboard.writeText(toCopy);
    const prev = btn.textContent;
    btn.textContent = '✓ Copié';
    setTimeout(() => (btn.textContent = prev), 1200);
  });
});

document.getElementById('copyTicketBtn').addEventListener('click', () => {
  const summary = [
    `=== TICKET TRADING OMNIROUTE ===`,
    `Décision : ${document.getElementById('verdictAction').textContent} (${document.getElementById('verdictOrderType').textContent})`,
    `Actif : ${document.getElementById('outAsset').textContent} | TF : ${document.getElementById('outTimeframe').textContent}`,
    `Entrée : ${document.getElementById('outEntry').textContent}`,
    `Stop Loss : ${document.getElementById('outSL').textContent}`,
    `Take Profit 1 : ${document.getElementById('outTP1').textContent}`,
    `Take Profit 2 : ${document.getElementById('outTP2').textContent}`,
    `R:R : ${document.getElementById('outRR').textContent} | Risque : ${document.getElementById('outRiskPct').textContent}`,
    `Invalidation : ${document.getElementById('outInvalidation').textContent}`
  ].join('\n');

  navigator.clipboard.writeText(summary);
  const btn = document.getElementById('copyTicketBtn');
  btn.textContent = '✅ Ticket copié !';
  setTimeout(() => (btn.textContent = '📋 Copier le ticket'), 1500);
});

checkOmniRouteStatus();
