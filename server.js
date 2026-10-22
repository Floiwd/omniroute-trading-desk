const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// Chargement automatique d'un fichier .env local s'il existe (sans dépendance externe)
try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const match = line.match(/^\s*([A-Za-z_0-9]+)\s*=\s*(.*)?\s*$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
      }
    }
  }
} catch {}

const PORT = process.env.PORT || 3080;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY_BYTES = 20 * 1024 * 1024;

// ---------------------------------------------------------------------------
// FOURNISSEURS D'IA
//  - "gemini"    : clé API Google Gemini directe (AI Studio). Fonctionne en local ET sur Vercel.
//                  Source : variable GEMINI_API_KEY, ou Trousseau macOS (service "gemini-api-key").
//  - "omniroute" : routeur local OmniRoute (http://127.0.0.1:20128). Local uniquement.
//                  Source : variable OMNIROUTE_API_KEY, ou Trousseau macOS (service "omniroute-ia").
// ---------------------------------------------------------------------------
const OMNIROUTE_BASE = process.env.OMNIROUTE_URL || 'http://127.0.0.1:20128/v1';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/openai';
const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
const XAI_BASE = 'https://api.x.ai/v1';
const GROQ_BASE = 'https://api.groq.com/openai/v1';

// Profils d'analyse : modèles mesurés sur un graphique test.
const PROFILES = {
  omniroute: {
    rapide: { primary: ['gemini/gemini-3.8-flash@low', 'gemini/gemini-3-flash-preview@low'], verifier: null },
    precis: {
      primary: ['gemini/gemini-3.8-flash@low', 'gemini/gemini-3.7-flash@low'],
      verifier: ['gemini/gemini-3-flash-preview@low', 'agy/gemini-3.8-flash-low']
    },
    ultra: {
      primary: ['agy/gemini-4-argon-low', 'gemini/gemini-4-argon@low', 'agy/gemini-3.8-flash-medium'],
      verifier: ['gemini/gemini-3.8-flash@low', 'gemini/gemini-3-flash-preview@low']
    }
  },
  gemini: {
    rapide: { primary: ['gemini-3.8-flash@low', 'gemini-3-flash-preview@low'], verifier: null },
    precis: {
      primary: ['gemini-3.8-flash@low', 'gemini-3.7-flash@low'],
      verifier: ['gemini-3-flash-preview@low', 'gemini-flash-latest@low']
    },
    ultra: {
      primary: ['gemini-4-argon@low', 'gemini-3.1-pro-preview@low', 'gemini-3.8-flash@medium'],
      verifier: ['gemini-3.8-flash@low', 'gemini-3-flash-preview@low']
    }
  },
  openrouter: {
    rapide: { primary: ['google/gemini-2.5-flash', 'nvidia/nemotron-3.5-super-vl:free'], verifier: null },
    precis: {
      primary: ['google/gemini-2.5-flash', 'nvidia/nemotron-3.5-super-vl:free'],
      verifier: null
    },
    ultra: {
      primary: ['google/gemini-2.5-flash', 'nvidia/nemotron-3.5-super-vl:free'],
      verifier: ['nvidia/nemotron-3.5-super-vl:free']
    }
  },
  grok: {
    rapide: { primary: ['grok-2-vision-1212', 'grok-vision-beta'], verifier: null },
    precis: { primary: ['grok-2-vision-1212'], verifier: ['grok-2-vision-1212'] },
    ultra: { primary: ['grok-2-vision-1212'], verifier: ['grok-2-vision-1212'] }
  },
  groq: {
    rapide: { primary: ['llama-3.2-11b-vision-preview'], verifier: null },
    precis: { primary: ['llama-3.2-90b-vision-preview'], verifier: ['llama-3.2-11b-vision-preview'] },
    ultra: { primary: ['llama-3.2-90b-vision-preview'], verifier: ['llama-3.2-11b-vision-preview'] }
  }
};

const PROFILE_TIMEOUTS = { rapide: 20000, precis: 25000, ultra: 45000 };
// Délai avant de lancer en parallèle un modèle de secours si le premier traîne (requête "hedgée").
const HEDGE_DELAY = { rapide: 7000, precis: 9000, ultra: 18000 };
const MIN_RR = 1.8;

// ---------------------------------------------------------------------------
// CLÉS API
// ---------------------------------------------------------------------------
const keyCache = new Map();
function readKeychain(service) {
  if (process.platform !== 'darwin') return null;
  if (keyCache.has(service)) return keyCache.get(service);
  let value = null;
  try {
    value = execFileSync('security', ['find-generic-password', '-s', service, '-w'], {
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim() || null;
  } catch {
    value = null;
  }
  keyCache.set(service, value);
  return value;
}

function getGeminiKey() {
  return (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim() || readKeychain('gemini-api-key');
}

function getOmniRouteKey() {
  return (process.env.OMNIROUTE_API_KEY || '').trim() || readKeychain('omniroute-ia');
}

const looksLikeGeminiKey = key => /^(AIza|AQ\.)[0-9A-Za-z_.-]{20,}$/.test(key || '');

function maskKey(key) {
  if (!key) return null;
  return key.length > 12 ? `${key.slice(0, 6)}••••${key.slice(-4)}` : '••••';
}

async function isOmniRouteOnline(key) {
  try {
    const r = await fetch(`${OMNIROUTE_BASE}/models`, {
      headers: key ? { Authorization: `Bearer ${key}` } : {},
      signal: AbortSignal.timeout(1500)
    });
    if (!r.ok) return { online: false, modelCount: 0 };
    const d = await r.json();
    return { online: true, modelCount: Array.isArray(d.data) ? d.data.length : 0 };
  } catch {
    return { online: false, modelCount: 0 };
  }
}

// Choisit le meilleur fournisseur disponible.
async function resolveProvider(customApiKey) {
  const custom = (customApiKey || '').trim();
  // Ignorer toute clé masquée ou corrompue contenant des puces ••••
  if (custom && !custom.includes('•')) {
    if (custom.startsWith('xai-')) {
      return { name: 'grok', base: XAI_BASE, apiKey: custom, source: 'navigateur (Grok xAI)' };
    }
    if (custom.startsWith('gsk_')) {
      return { name: 'groq', base: GROQ_BASE, apiKey: custom, source: 'navigateur (Groq)' };
    }
    if (custom.startsWith('sk-or-')) {
      return { name: 'openrouter', base: OPENROUTER_BASE, apiKey: custom, source: 'navigateur (OpenRouter)' };
    }
    if (looksLikeGeminiKey(custom)) {
      return { name: 'gemini', base: GEMINI_BASE, apiKey: custom, source: 'navigateur (Gemini)' };
    }
    // Clé OmniRoute locale : UNIQUEMENT si le serveur local 127.0.0.1 répond
    const omni = await isOmniRouteOnline(custom);
    if (omni.online) {
      return { name: 'omniroute', base: OMNIROUTE_BASE, apiKey: custom, source: 'navigateur (OmniRoute)' };
    }
  }

  // 1. OmniRoute local si disponible (sur Mac)
  const omniKey = getOmniRouteKey();
  const omni = omniKey ? await isOmniRouteOnline(omniKey) : { online: false };
  if (omni.online) {
    return { name: 'omniroute', base: OMNIROUTE_BASE, apiKey: omniKey, source: 'trousseau (OmniRoute)' };
  }

  // 2. OpenRouter côté serveur si configuré (Recommandé en production cloud / Vercel)
  const openrouterKey = (process.env.OPENROUTER_API_KEY || '').trim();
  if (openrouterKey) {
    return { name: 'openrouter', base: OPENROUTER_BASE, apiKey: openrouterKey, source: 'serveur (OpenRouter)' };
  }

  // 3. Grok (xAI) côté serveur si configuré
  const xaiKey = (process.env.XAI_API_KEY || process.env.GROK_API_KEY || '').trim();
  if (xaiKey) {
    return { name: 'grok', base: XAI_BASE, apiKey: xaiKey, source: 'serveur (Grok xAI)' };
  }

  // 4. Groq (LPU) côté serveur si configuré
  const groqKey = (process.env.GROQ_API_KEY || '').trim();
  if (groqKey) {
    return { name: 'groq', base: GROQ_BASE, apiKey: groqKey, source: 'serveur (Groq)' };
  }

  // 5. Clé Gemini (Trousseau ou variable d'environnement GEMINI_API_KEY)
  const geminiKey = getGeminiKey();
  if (geminiKey) {
    return {
      name: 'gemini',
      base: GEMINI_BASE,
      apiKey: geminiKey,
      source: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY ? 'variable d’environnement (Gemini)' : 'trousseau (Gemini)'
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// PROMPTS
// ---------------------------------------------------------------------------
const OCR_SCHEMA = `{
  "image_quality": {
    "is_trading_chart": true,
    "price_axis_readable": true,
    "timeframe_readable": true,
    "symbol_readable": true,
    "visibility_score_0_to_100": 90,
    "missing_or_blurry_elements": []
  },
  "extracted_facts": {
    "symbol_on_chart": "symbole lu ou ILLISIBLE",
    "timeframe_on_chart": "unité de temps lue ou ILLISIBLE",
    "current_price_on_chart": "prix actuel encadré sur l'axe (nombre seul) ou ILLISIBLE",
    "visible_price_range_high": "plus haute graduation lisible de l'axe (nombre seul) ou ILLISIBLE",
    "visible_price_range_low": "plus basse graduation lisible de l'axe (nombre seul) ou ILLISIBLE",
    "price_decimals": 2,
    "last_candles_observation": "description factuelle des dernières bougies",
    "visible_indicators_or_drawings": []
  },
  "key_visible_levels": {
    "nearest_resistances": ["nombre"],
    "nearest_supports": ["nombre"]
  }
}`;

const PLAN_SCHEMA = `{
  "verdict": {
    "action": "BUY | SELL | WAIT | NO_TRADE",
    "order_type": "MARKET | BUY_LIMIT | SELL_LIMIT | BUY_STOP | SELL_STOP | AUCUN",
    "confidence_score": 0,
    "hallucination_guard_status": "SAFE_VERIFIED | WARNING_PARTIAL_DATA | BLOCKED_UNREADABLE_CHART",
    "headline_reason": "une phrase directe"
  },
  "essential_order_inputs": {
    "asset": "actif vérifié",
    "timeframe": "unité de temps vérifiée",
    "current_price": "nombre seul",
    "entry_price": "nombre seul (ou condition d'attente si WAIT/NO_TRADE)",
    "stop_loss": "nombre seul",
    "take_profit_1": "nombre seul",
    "take_profit_2": "nombre seul",
    "risk_reward_ratio": "1:x",
    "recommended_risk_pct": "x%"
  },
  "market_structure_facts": {
    "trend_bias": "HAUSSIER | BAISSIER | RANGE / NEUTRE | INCERTAIN",
    "key_support_zone": "zone lue",
    "key_resistance_zone": "zone lue",
    "observed_confluences": ["fait visuel observé"]
  },
  "strict_checklist_before_clicking": ["point à vérifier"],
  "invalidation_warning": "ce qui annule le scénario"
}`;

const RISK_RULES = `PROTOCOLE ANTI-PERTE & ANTI-HALLUCINATION (STRICT) :
1. N'INVENTE AUCUN PRIX. Lis l'axe vertical des prix caractère par caractère. Si l'axe est illisible ou le prix actuel introuvable : action "NO_TRADE" et niveaux "ILLISIBLE".
2. Tous les niveaux (entrée, SL, TP) doivent se situer dans la plage de prix visible de l'axe, ou très proches.
3. PAS DE TRADE FORCÉ : range haché, structure ambiguë ou R:R < 1:${MIN_RR} sur le TP principal ⇒ "WAIT" ou "NO_TRADE".
4. COHÉRENCE : BUY ⇒ SL < Entrée < TP1 < TP2. SELL ⇒ SL > Entrée > TP1 > TP2.
5. TYPE D'ORDRE : BUY sous le prix actuel = BUY_LIMIT, au-dessus = BUY_STOP ; SELL au-dessus = SELL_LIMIT, en dessous = SELL_STOP ; au prix actuel = MARKET.
6. Le SL se place derrière une structure visible (creux/sommet), pas à une distance arbitraire.
7. Les champs de prix contiennent UNIQUEMENT un nombre avec le séparateur décimal "." (ex: 2657.20), sans devise ni texte.
8. Si le contexte déclaré par le trader contredit le graphique, fais confiance au graphique et signale-le.`;

function userContextBlock(ctx) {
  return `CONTEXTE DÉCLARÉ PAR LE TRADER (peut être vide — ne jamais le substituer à la lecture du graphique) :
- Actif : ${ctx.symbol || 'non précisé'}
- Timeframe : ${ctx.timeframe || 'non précisé'}
- Capital : ${ctx.capital || 'non précisé'} · Risque max par trade : ${ctx.riskPercent || '1'}%
- Note / biais : ${ctx.notes || 'aucune'}`;
}

function buildSinglePassPrompt(ctx) {
  return `Tu es un Gestionnaire de Risque Institutionnel et Analyste Technique Senior. Le trader exige ZÉRO HALLUCINATION : il préfère mille fois "NE PAS TRADER" à un signal incertain.

Procède en deux temps DANS LA MÊME RÉPONSE :
A) "ocr_facts" : lis UNIQUEMENT ce qui est visible (symbole, timeframe, prix actuel encadré, graduations haute/basse de l'axe, dernières bougies, niveaux). Toute info floue/coupée = "ILLISIBLE".
B) "plan" : construis le plan d'exécution en t'appuyant exclusivement sur A).

${RISK_RULES}

${userContextBlock(ctx)}

Réponds UNIQUEMENT avec un objet JSON valide :
{ "ocr_facts": ${OCR_SCHEMA},
  "plan": ${PLAN_SCHEMA} }`;
}

const OCR_ONLY_PROMPT = `Tu es un extracteur de données visuelles de graphiques financiers ULTRA-RIGOUREUX et ANTI-HALLUCINATION.
Lis EXACTEMENT ce qui est visible sur la capture, SANS RIEN INVENTER. Toute information floue, coupée ou absente = "ILLISIBLE".
Lis l'axe vertical des prix caractère par caractère et repère le prix actuel encadré.
Réponds UNIQUEMENT avec un objet JSON valide :
${OCR_SCHEMA}`;

function buildPlanPrompt(ocrFacts, ctx) {
  return `Tu es un Gestionnaire de Risque Institutionnel et Analyste Technique Senior. ZÉRO HALLUCINATION exigée.

DONNÉES FACTUELLES EXTRAITES DU GRAPHIQUE (ÉTAPE 1) :
${JSON.stringify(ocrFacts, null, 2)}

${userContextBlock(ctx)}

${RISK_RULES}

Réponds UNIQUEMENT avec un objet JSON valide :
${PLAN_SCHEMA}`;
}

// ---------------------------------------------------------------------------
// APPELS MODÈLES (OpenAI-compatible : OmniRoute ou Gemini)
// ---------------------------------------------------------------------------
function parseModelSpec(spec) {
  const [model, effort] = spec.split('@');
  return { model, effort: effort || null };
}

async function callModel(provider, spec, messages, { timeoutMs, signal }) {
  const { model, effort } = parseModelSpec(spec);
  const body = {
    model,
    temperature: 0,
    messages,
    response_format: { type: 'json_object' },
    max_tokens: 1500
  };
  if (effort) body.reasoning_effort = effort;

  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

  const headers = { 'Content-Type': 'application/json' };
  if (provider.name === 'gemini') {
    headers['x-goog-api-key'] = provider.apiKey;
    headers['Authorization'] = `Bearer ${provider.apiKey}`;
  } else if (provider.name === 'openrouter') {
    headers['Authorization'] = `Bearer ${provider.apiKey}`;
    headers['HTTP-Referer'] = 'https://omniroute-trading-desk.vercel.app';
    headers['X-Title'] = 'OmniRoute Trading Desk';
  } else {
    headers['Authorization'] = `Bearer ${provider.apiKey}`;
  }

  let response;
  try {
    response = await fetch(`${provider.base}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: combined
    });
  } catch (err) {
    if (timeoutSignal.aborted) throw new Error(`${model}: délai dépassé (${Math.round(timeoutMs / 1000)} s)`);
    if (signal?.aborted) throw new Error(`${model}: annulé`);
    throw new Error(`${model}: ${err.message}`);
  }

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`${model}: réponse non JSON (HTTP ${response.status})`);
  }
  if (Array.isArray(data)) data = data[0] || {};
  if (!response.ok || data.error) {
    const msg = data.error?.message || data.message || `HTTP ${response.status}`;
    throw new Error(`${model}: ${String(msg).slice(0, 200)}`);
  }
  const content = data.choices?.[0]?.message?.content;
  if (!content || !String(content).trim()) throw new Error(`${model}: réponse vide`);

  return { content: String(content).trim(), usedModel: data.model || model, spec };
}

// Lance le 1er modèle ; si pas de réponse après `hedgeDelay` (ou en cas d'échec), lance le suivant
// EN PARALLÈLE. Le premier résultat valide gagne, les autres requêtes sont annulées.
function callWithHedge(provider, specs, messages, { timeoutMs, hedgeDelay, validate }) {
  return new Promise((resolve, reject) => {
    const errors = [];
    const controllers = [];
    let next = 0;
    let running = 0;
    let settled = false;
    let hedgeTimer = null;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(hedgeTimer);
      controllers.forEach(c => c.abort());
      fn(value);
    };

    const launch = () => {
      if (settled || next >= specs.length) return;
      const spec = specs[next++];
      const controller = new AbortController();
      controllers.push(controller);
      running++;
      clearTimeout(hedgeTimer);
      hedgeTimer = setTimeout(launch, hedgeDelay);

      const started = Date.now();
      callModel(provider, spec, messages, { timeoutMs, signal: controller.signal })
        .then(result => {
          const parsed = parseJsonSafely(result.content);
          if (validate) validate(parsed);
          finish(resolve, { ...result, parsed, latencyMs: Date.now() - started });
        })
        .catch(err => {
          if (settled) return;
          errors.push(err.message.startsWith(parseModelSpec(spec).model) ? err.message : `${spec}: ${err.message}`);
          running--;
          if (next < specs.length) launch();
          else if (running === 0) finish(reject, new Error(`Tous les modèles ont échoué : ${errors.join(' | ')}`));
        });
    };

    launch();
  });
}

// Extraction robuste d'un JSON même entouré de ```json ... ``` ou de texte.
function parseJsonSafely(rawText) {
  let cleaned = String(rawText || '').trim();
  const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (codeBlockMatch) cleaned = codeBlockMatch[1].trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const first = cleaned.indexOf('{');
    const last = cleaned.lastIndexOf('}');
    if (first !== -1 && last > first) return JSON.parse(cleaned.slice(first, last + 1));
    throw new Error('Réponse du modèle illisible (JSON invalide)');
  }
}

// ---------------------------------------------------------------------------
// VALIDATION MATHÉMATIQUE CÔTÉ SERVEUR
// ---------------------------------------------------------------------------

// Convertit "2,657.20", "1.08450", "2657,2", "≈ 2650.00 (zone)" → nombre. Ignore les ratios "1:2.4".
function parsePrice(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const str = value.replace(/\b\d+(?:[.,]\d+)?\s*:\s*\d+(?:[.,]\d+)?\b/g, ' ');
  const match = str.match(/-?\d[\d\s.,']*/);
  if (!match) return null;
  let token = match[0].trim().replace(/[\s']/g, '').replace(/[.,]+$/, '');
  const lastDot = token.lastIndexOf('.');
  const lastComma = token.lastIndexOf(',');
  if (lastDot !== -1 && lastComma !== -1) {
    const decimalSep = lastDot > lastComma ? '.' : ',';
    const thousandSep = decimalSep === '.' ? ',' : '.';
    token = token.split(thousandSep).join('').replace(decimalSep, '.');
  } else if (lastComma !== -1) {
    const parts = token.split(',');
    token = parts.length > 2 || (parts.length === 2 && parts[1].length === 3 && parts[0].length <= 3 && parts[0] !== '0')
      ? parts.join('')
      : parts.join('.');
  } else if ((token.match(/\./g) || []).length > 1) {
    token = token.split('.').join('');
  }
  const num = parseFloat(token);
  return Number.isFinite(num) ? num : null;
}

function countDecimals(value) {
  const m = String(value ?? '').match(/[.,](\d+)\s*$/);
  return m ? m[1].length : 0;
}

function ensurePlanShape(plan) {
  const p = plan && typeof plan === 'object' ? plan : {};
  p.verdict = p.verdict && typeof p.verdict === 'object' ? p.verdict : {};
  p.essential_order_inputs = p.essential_order_inputs && typeof p.essential_order_inputs === 'object' ? p.essential_order_inputs : {};
  p.market_structure_facts = p.market_structure_facts && typeof p.market_structure_facts === 'object' ? p.market_structure_facts : {};
  if (!Array.isArray(p.market_structure_facts.observed_confluences)) p.market_structure_facts.observed_confluences = [];
  if (!Array.isArray(p.strict_checklist_before_clicking)) p.strict_checklist_before_clicking = [];
  p.verdict.action = String(p.verdict.action || 'WAIT').toUpperCase().replace(/[\s-]+/g, '_');
  if (!['BUY', 'SELL', 'WAIT', 'NO_TRADE'].includes(p.verdict.action)) p.verdict.action = 'WAIT';
  p.verdict.order_type = String(p.verdict.order_type || 'AUCUN').toUpperCase().replace(/[\s-]+/g, '_');
  const conf = Number(p.verdict.confidence_score);
  p.verdict.confidence_score = Number.isFinite(conf) ? Math.max(0, Math.min(100, Math.round(conf))) : 0;
  return p;
}

function ensureOcrShape(ocr) {
  const o = ocr && typeof ocr === 'object' ? ocr : {};
  o.image_quality = o.image_quality && typeof o.image_quality === 'object' ? o.image_quality : {};
  o.extracted_facts = o.extracted_facts && typeof o.extracted_facts === 'object' ? o.extracted_facts : {};
  return o;
}

function blockPlan(plan, status, reason, levelsLabel) {
  plan.verdict.action = 'NO_TRADE';
  plan.verdict.order_type = 'AUCUN';
  plan.verdict.hallucination_guard_status = status;
  plan.verdict.headline_reason = reason;
  plan.verdict.confidence_score = Math.min(plan.verdict.confidence_score, 25);
  plan.essential_order_inputs.recommended_risk_pct = '0%';
  if (levelsLabel) {
    ['entry_price', 'stop_loss', 'take_profit_1', 'take_profit_2'].forEach(k => {
      plan.essential_order_inputs[k] = levelsLabel;
    });
    plan.essential_order_inputs.risk_reward_ratio = '--';
  }
}

function downgradeToWait(plan, reason) {
  plan.verdict.action = 'WAIT';
  plan.verdict.order_type = 'AUCUN';
  plan.verdict.headline_reason = reason;
  plan.essential_order_inputs.recommended_risk_pct = '0%';
}

function validateAndSanitizePlan(ocrInput, planInput, ctx = {}) {
  const ocr = ensureOcrShape(ocrInput);
  const plan = ensurePlanShape(planInput);
  const flags = [];
  const iq = ocr.image_quality;
  const facts = ocr.extracted_facts;
  const inputs = plan.essential_order_inputs;

  const visibility = Number(iq.visibility_score_0_to_100);
  const visibilityScore = Number.isFinite(visibility) ? visibility : 50;
  const currentFromOcr = parsePrice(facts.current_price_on_chart);
  const current = currentFromOcr ?? parsePrice(inputs.current_price);
  const axisHigh = parsePrice(facts.visible_price_range_high);
  const axisLow = parsePrice(facts.visible_price_range_low);

  if (!plan.verdict.hallucination_guard_status) plan.verdict.hallucination_guard_status = 'SAFE_VERIFIED';

  // 1. Image exploitable ?
  if (iq.is_trading_chart === false) {
    blockPlan(plan, 'BLOCKED_UNREADABLE_CHART', "L'image envoyée ne semble pas être un graphique de trading exploitable.", 'NON DISPONIBLE');
    plan.verdict.confidence_score = 0;
    flags.push('BLOQUÉ : image non reconnue comme graphique de trading.');
  } else if (iq.price_axis_readable === false || visibilityScore < 45 || current === null) {
    blockPlan(
      plan,
      'BLOCKED_UNREADABLE_CHART',
      "L'axe des prix ou le prix actuel n'est pas lisible : aucun niveau ne peut être donné sans risque d'invention.",
      'NON DISPONIBLE (axe des prix illisible)'
    );
    flags.push("PROTECTION ACTIVÉE : échelle de prix absente/floue ou prix actuel introuvable. Aucun niveau n'a été inventé.");
  }

  const action = plan.verdict.action;
  const isTrade = action === 'BUY' || action === 'SELL';
  const entry = parsePrice(inputs.entry_price);
  const sl = parsePrice(inputs.stop_loss);
  const tp1 = parsePrice(inputs.take_profit_1);
  const tp2 = parsePrice(inputs.take_profit_2);

  if (isTrade) {
    // 2. Niveaux présents ?
    if (entry === null || sl === null || tp1 === null) {
      blockPlan(plan, 'WARNING_PARTIAL_DATA', 'Plan incomplet (entrée, stop loss ou TP1 manquant) : trade annulé par sécurité.');
      flags.push('ALERTE : niveaux manquants dans la réponse du modèle → NO_TRADE.');
    } else {
      const isBuy = action === 'BUY';
      const ordered = isBuy ? sl < entry && entry < tp1 : sl > entry && entry > tp1;
      const tp2Ordered = tp2 === null || (isBuy ? tp2 >= tp1 : tp2 <= tp1);

      // 3. Plausibilité : niveaux dans (ou très proches de) la plage visible.
      let lo = axisLow;
      let hi = axisHigh;
      if (lo !== null && hi !== null && lo > hi) [lo, hi] = [hi, lo];
      const span = lo !== null && hi !== null && hi > lo ? hi - lo : current * 0.05;
      const minOk = (lo ?? current - span) - span * 0.5;
      const maxOk = (hi ?? current + span) + span * 0.5;
      const outOfRange = [entry, sl, tp1, tp2].filter(v => v !== null && (v < minOk || v > maxOk));

      if (!ordered) {
        blockPlan(
          plan,
          'WARNING_PARTIAL_DATA',
          `Incohérence mathématique sur le ${action} (SL ${sl} · Entrée ${entry} · TP1 ${tp1}) : trade annulé par sécurité.`
        );
        flags.push(`ALERTE : niveaux ${action} incohérents (ordre SL/Entrée/TP invalide) → NO_TRADE.`);
      } else if (outOfRange.length) {
        blockPlan(
          plan,
          'WARNING_PARTIAL_DATA',
          `Niveau(x) hors de la plage de prix visible (${outOfRange.join(', ')}) : probable erreur de lecture, trade annulé.`
        );
        flags.push(`ALERTE HALLUCINATION : niveaux hors plage visible [${minOk.toFixed(2)} – ${maxOk.toFixed(2)}] → NO_TRADE.`);
      } else {
        const risk = Math.abs(entry - sl);
        const rr1 = risk > 0 ? Math.abs(tp1 - entry) / risk : 0;
        const rr2 = risk > 0 && tp2 !== null && tp2Ordered ? Math.abs(tp2 - entry) / risk : null;
        const mainRR = rr2 ?? rr1;
        inputs.risk_reward_ratio = rr2 !== null ? `1:${rr1.toFixed(2)} (TP1) · 1:${rr2.toFixed(2)} (TP2)` : `1:${rr1.toFixed(2)} (TP1)`;
        if (!tp2Ordered) {
          inputs.take_profit_2 = `${inputs.take_profit_2} (ignoré : incohérent)`;
          flags.push('AJUSTÉ : TP2 incohérent avec TP1, ignoré.');
        }

        const decimals = Math.max(countDecimals(facts.current_price_on_chart), countDecimals(inputs.entry_price), 2);
        const slDistance = risk.toFixed(Math.min(decimals, 5));
        plan.computed = {
          entry, stop_loss: sl, take_profit_1: tp1, take_profit_2: tp2Ordered ? tp2 : null,
          rr_tp1: Number(rr1.toFixed(2)), rr_tp2: rr2 !== null ? Number(rr2.toFixed(2)) : null,
          sl_distance: Number(slDistance), sl_distance_pct: current ? Number(((risk / current) * 100).toFixed(3)) : null
        };

        if (mainRR < MIN_RR) {
          downgradeToWait(plan, `R:R insuffisant (1:${mainRR.toFixed(2)} < 1:${MIN_RR}) : attendre un meilleur point d'entrée.`);
          flags.push(`FILTRE R:R : ratio recalculé 1:${mainRR.toFixed(2)} inférieur au minimum 1:${MIN_RR} → WAIT.`);
        } else if (plan.verdict.confidence_score < 50) {
          downgradeToWait(plan, `Certitude trop faible (${plan.verdict.confidence_score}%) pour engager du capital.`);
          flags.push('FILTRE CERTITUDE : score < 50% → WAIT.');
        } else {
          // 4. Type d'ordre cohérent avec le prix actuel.
          const tolerance = Math.max(span * 0.01, current * 0.0003);
          const expected = Math.abs(entry - current) <= tolerance
            ? 'MARKET'
            : isBuy ? (entry < current ? 'BUY_LIMIT' : 'BUY_STOP') : (entry > current ? 'SELL_LIMIT' : 'SELL_STOP');
          const given = plan.verdict.order_type;
          if (given !== expected && !(expected !== 'MARKET' && given === 'MARKET' && Math.abs(entry - current) <= tolerance * 3)) {
            plan.verdict.order_type = expected;
            flags.push(`AJUSTÉ : type d'ordre corrigé ${given || '?'} → ${expected} (entrée ${entry} vs prix actuel ${current}).`);
          }
          flags.push(
            `VÉRIFIÉ : cohérence ${isBuy ? 'ACHAT' : 'VENTE'} (${sl} ${isBuy ? '<' : '>'} ${entry} ${isBuy ? '<' : '>'} ${tp1}) · R:R recalculé ${inputs.risk_reward_ratio}.`
          );
          const maxRisk = Number(ctx.riskPercent);
          const recommended = parsePrice(inputs.recommended_risk_pct);
          if (Number.isFinite(maxRisk) && (recommended === null || recommended > maxRisk)) {
            inputs.recommended_risk_pct = `${maxRisk}%`;
          }
        }
      }
    }
  } else {
    plan.verdict.order_type = 'AUCUN';
    inputs.recommended_risk_pct = '0%';
  }

  if (current !== null && !inputs.current_price) inputs.current_price = String(current);
  if (!flags.length) {
    flags.push(`VÉRIFIÉ : lecture (visibilité ${visibilityScore}/100) et contrôle des niveaux sans anomalie.`);
  }
  plan.audit_trail = [...(plan.audit_trail || []), ...flags];
  return plan;
}

// Croisement de deux lectures indépendantes (consensus anti-hallucination).
function applyConsensus(plan, primaryOcr, verifierResult) {
  const flags = [];
  if (!verifierResult) return flags;
  const vOcr = ensureOcrShape(verifierResult.ocr);
  const vPlan = ensurePlanShape(verifierResult.plan);
  const p1 = parsePrice(ensureOcrShape(primaryOcr).extracted_facts.current_price_on_chart);
  const p2 = parsePrice(vOcr.extracted_facts.current_price_on_chart);
  const model = verifierResult.model;

  if (p1 !== null && p2 !== null) {
    const diff = Math.abs(p1 - p2) / Math.max(Math.abs(p1), 1e-9);
    if (diff > 0.003) {
      if (plan.verdict.action === 'BUY' || plan.verdict.action === 'SELL') {
        blockPlan(plan, 'WARNING_PARTIAL_DATA', `Les deux modèles ne lisent pas le même prix actuel (${p1} vs ${p2}) : lecture non fiable, trade annulé.`);
      }
      flags.push(`CONSENSUS ÉCHOUÉ : prix actuel lu ${p1} vs ${p2} (${model}) → écart ${(diff * 100).toFixed(2)}%.`);
      return flags;
    }
    flags.push(`CONSENSUS : prix actuel confirmé par un 2e modèle (${p1} ≈ ${p2}, ${model}).`);
  }

  const a1 = plan.verdict.action;
  const a2 = vPlan.verdict.action;
  if ((a1 === 'BUY' && a2 === 'SELL') || (a1 === 'SELL' && a2 === 'BUY')) {
    blockPlan(plan, 'WARNING_PARTIAL_DATA', `Désaccord de direction entre les modèles (${a1} vs ${a2}) : pas de trade.`);
    flags.push(`CONSENSUS ÉCHOUÉ : directions opposées (${a1} vs ${a2}) → NO_TRADE.`);
  } else if ((a1 === 'BUY' || a1 === 'SELL') && a1 !== a2) {
    plan.verdict.confidence_score = Math.min(plan.verdict.confidence_score, 60);
    plan.verdict.hallucination_guard_status = 'WARNING_PARTIAL_DATA';
    flags.push(`CONSENSUS PARTIEL : le 2e modèle recommande ${a2}. Certitude plafonnée à 60%, prudence.`);
  } else if (a1 === a2) {
    flags.push(`CONSENSUS : les deux modèles concluent ${a1}.`);
  }
  return flags;
}

// ---------------------------------------------------------------------------
// ORCHESTRATION DE L'ANALYSE
// ---------------------------------------------------------------------------
function imageMessage(text, imageBase64) {
  return {
    role: 'user',
    content: [
      { type: 'text', text },
      { type: 'image_url', image_url: { url: imageBase64 } }
    ]
  };
}

const requireOcrAndPlan = parsed => {
  if (!parsed || typeof parsed !== 'object' || !parsed.plan || !parsed.ocr_facts) {
    throw new Error('structure JSON incomplète (ocr_facts/plan)');
  }
};

async function runAnalysis(provider, mode, imageBase64, ctx) {
  const profile = PROFILES[provider.name][mode] || PROFILES[provider.name].precis;
  const timeoutMs = PROFILE_TIMEOUTS[mode] || 25000;
  const hedgeDelay = HEDGE_DELAY[mode] || 9000;
  const primarySpecs = ctx.preferredModel && ctx.preferredModel !== 'auto'
    ? [...new Set([ctx.preferredModel, ...profile.primary])]
    : profile.primary;

  const singlePassMessages = [
    { role: 'system', content: buildSinglePassPrompt(ctx) },
    imageMessage(
      "Analyse ce graphique. Lis rigoureusement l'axe des prix, n'invente rien, puis donne le plan au format JSON demandé.",
      imageBase64
    )
  ];

  // Vérificateur indépendant lancé EN PARALLÈLE (aucun temps d'attente supplémentaire).
  const verifierPromise = profile.verifier
    ? callWithHedge(provider, profile.verifier, singlePassMessages, { timeoutMs, hedgeDelay, validate: requireOcrAndPlan })
        .then(r => ({ ocr: r.parsed.ocr_facts, plan: r.parsed.plan, model: r.usedModel }))
        .catch(err => ({ error: err.message }))
    : Promise.resolve(null);

  let ocrFacts;
  let planData;
  let ocrModel;
  let decisionModel;

  if (mode === 'ultra') {
    // Double passe : OCR strict puis plan basé sur les faits extraits.
    const step1 = await callWithHedge(
      provider,
      primarySpecs,
      [{ role: 'system', content: OCR_ONLY_PROMPT }, imageMessage(
        `Lis uniquement les faits visibles. Contexte déclaré : actif="${ctx.symbol || 'non précisé'}", timeframe="${ctx.timeframe || 'non précisé'}".`,
        imageBase64
      )],
      { timeoutMs, hedgeDelay, validate: p => { if (!p.image_quality && !p.extracted_facts) throw new Error('OCR incomplet'); } }
    );
    ocrFacts = step1.parsed;
    ocrModel = step1.usedModel;

    const step2 = await callWithHedge(
      provider,
      primarySpecs,
      [{ role: 'system', content: buildPlanPrompt(ocrFacts, ctx) }, imageMessage(
        "À partir de l'image ET des faits extraits ci-dessus, produis le plan d'exécution final ultra-prudent (JSON).",
        imageBase64
      )],
      { timeoutMs, hedgeDelay, validate: p => { if (!p.verdict) throw new Error('plan incomplet'); } }
    );
    planData = step2.parsed;
    decisionModel = step2.usedModel;
  } else {
    const result = await callWithHedge(provider, primarySpecs, singlePassMessages, {
      timeoutMs,
      hedgeDelay,
      validate: requireOcrAndPlan
    });
    ocrFacts = result.parsed.ocr_facts;
    planData = result.parsed.plan;
    ocrModel = decisionModel = result.usedModel;
  }

  // Le vérificateur a au plus 4 s de plus que le modèle principal pour répondre.
  const verifier = await Promise.race([
    verifierPromise,
    new Promise(r => setTimeout(() => r({ error: 'trop lent (ignoré)' }), 4000))
  ]);

  planData = validateAndSanitizePlan(ocrFacts, planData, ctx);
  if (verifier && !verifier.error) {
    planData.audit_trail.push(...applyConsensus(planData, ocrFacts, verifier));
  } else if (profile.verifier) {
    planData.audit_trail.push(`CONSENSUS INDISPONIBLE : 2e modèle ${verifier?.error || 'sans réponse'}.`);
  }

  return {
    ocrFacts,
    plan: planData,
    modelsUsed: { ocrModel, decisionModel, verifierModel: verifier && !verifier.error ? verifier.model : null }
  };
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}

// CORS : autorise la même origine, le domaine Vercel et localhost
function isAllowedOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const o = new URL(origin);
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    return o.host === host ||
      o.hostname.endsWith('.vercel.app') ||
      (['localhost', '127.0.0.1'].includes(o.hostname) && (o.port === String(PORT) || !o.port));
  } catch {
    return false;
  }
}

function readBody(req) {
  // Vercel peut fournir le corps déjà parsé.
  if (req.body !== undefined) {
    return Promise.resolve(typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Image trop lourde (max 20 Mo).'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handleStatus(res) {
  const omniKey = getOmniRouteKey();
  const geminiKey = getGeminiKey();
  const openrouterKey = (process.env.OPENROUTER_API_KEY || '').trim();
  const xaiKey = (process.env.XAI_API_KEY || process.env.GROK_API_KEY || '').trim();
  const groqKey = (process.env.GROQ_API_KEY || '').trim();
  const omni = await isOmniRouteOnline(omniKey);
  const activeProvider = (omni.online && omniKey)
    ? 'omniroute'
    : (openrouterKey ? 'openrouter' : (geminiKey ? 'gemini' : (xaiKey ? 'grok' : (groqKey ? 'groq' : null))));

  return sendJson(res, 200, {
    activeProvider,
    omnirouteOnline: omni.online,
    omnirouteUrl: OMNIROUTE_BASE,
    modelCount: omni.modelCount,
    hasKeychainKey: Boolean(omniKey),
    maskedKey: maskKey(omniKey),
    hasGeminiKey: Boolean(geminiKey),
    maskedGeminiKey: maskKey(geminiKey),
    hasOpenrouterKey: Boolean(openrouterKey),
    maskedOpenrouterKey: maskKey(openrouterKey)
  });
}

async function handleAnalyze(req, res) {
  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch (err) {
    return sendJson(res, err.status || 400, { error: err.status ? err.message : 'Requête invalide (JSON attendu).' });
  }

  const {
    imageBase64,
    customApiKey,
    preferredModel,
    analysisMode,
    doubleVerification,
    symbol = '',
    timeframe = '',
    capital = '',
    riskPercent = '1',
    notes = ''
  } = payload || {};

  if (typeof imageBase64 !== 'string' || !/^data:image\/(png|jpe?g|webp|gif|heic|heif);base64,/i.test(imageBase64)) {
    return sendJson(res, 400, { error: "Veuillez déposer une capture d'écran valide (PNG, JPG ou WebP)." });
  }

  const provider = await resolveProvider(customApiKey);
  if (!provider) {
    return sendJson(res, 401, {
      error:
        "Aucune clé API disponible. Lancez « npm run setup-key » (clé Gemini dans le Trousseau), définissez GEMINI_API_KEY, ou démarrez OmniRoute."
    });
  }

  const mode = ['rapide', 'precis', 'ultra'].includes(analysisMode) ? analysisMode : doubleVerification ? 'ultra' : 'precis';
  const ctx = {
    symbol: String(symbol).slice(0, 40),
    timeframe: String(timeframe).slice(0, 10),
    capital: String(capital).slice(0, 20),
    riskPercent: String(riskPercent).slice(0, 6),
    notes: String(notes).slice(0, 500),
    preferredModel: provider.name === 'omniroute' ? preferredModel : null
  };

  const started = Date.now();
  try {
    const result = await runAnalysis(provider, mode, imageBase64, ctx);
    return sendJson(res, 200, {
      success: true,
      provider: provider.name,
      mode,
      elapsedMs: Date.now() - started,
      ...result
    });
  } catch (err) {
    console.error('Analysis error:', err.message);
    return sendJson(res, 502, { error: err.message || "Erreur lors de l'analyse.", provider: provider.name });
  }
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function serveStatic(req, res) {
  let urlPath;
  try {
    urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  } catch {
    res.writeHead(400);
    return res.end('Bad request');
  }
  if (urlPath === '/') urlPath = '/index.html';
  const fullPath = path.normalize(path.join(PUBLIC_DIR, urlPath));
  if (!fullPath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  const ext = path.extname(fullPath).toLowerCase();
  if (!MIME_TYPES[ext]) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('404 - Fichier introuvable');
  }
  fs.readFile(fullPath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 - Fichier introuvable');
    }
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext], 'Cache-Control': 'no-cache' });
    res.end(content);
  });
}

const requestHandler = async (req, res) => {
  const parsedUrl = new URL(req.url || '/', 'http://localhost');
  const apiParam = parsedUrl.searchParams.get('apiPath');
  let url = apiParam ? `/api/${apiParam}` : parsedUrl.pathname;
  if (!url.startsWith('/api/') && req.headers['x-matched-path']?.startsWith('/api/')) {
    url = req.headers['x-matched-path'];
  }

  if (url.startsWith('/api/')) {
    if (!isAllowedOrigin(req)) return sendJson(res, 403, { error: 'Origine non autorisée.' });
    if (req.headers.origin) {
      res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }
    try {
      if (req.method === 'GET' && url === '/api/status') return await handleStatus(res);
      if (req.method === 'POST' && url === '/api/analyze') return await handleAnalyze(req, res);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) return sendJson(res, 500, { error: err.message || 'Erreur serveur.' });
      return;
    }
    return sendJson(res, 404, { error: 'Endpoint inconnu.' });
  }

  return serveStatic(req, res);
};

if (require.main === module) {
  const server = http.createServer(requestHandler);
  server.requestTimeout = 120000;
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`✅ Terminal Trading lancé sur http://localhost:${PORT}`);
  });
}

module.exports = requestHandler;
module.exports.parsePrice = parsePrice;
module.exports.validateAndSanitizePlan = validateAndSanitizePlan;
module.exports.applyConsensus = applyConsensus;
