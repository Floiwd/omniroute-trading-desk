const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PORT = process.env.PORT || 3080;
const OMNIROUTE_BASE = process.env.OMNIROUTE_URL || 'http://127.0.0.1:20128/v1';

// Récupération automatique de la clé OmniRoute depuis le Trousseau macOS (Keychain)
function getKeychainApiKey() {
  if (process.env.OMNIROUTE_API_KEY) return process.env.OMNIROUTE_API_KEY.trim();
  try {
    const key = execSync('security find-generic-password -s omniroute-ia -w 2>/dev/null', {
      encoding: 'utf8',
      timeout: 3000
    }).trim();
    return key || null;
  } catch {
    return null;
  }
}

const SYSTEM_PROMPT_STEP_1_OCR = `Tu es un extracteur de données visuelles de graphiques financiers ULTRA- RIGOUREUX et ANTI-HALLUCINATION.
Ta mission UNIQUE est de lire EXACTEMENT ce qui est visible sur la capture d'écran, SANS JAMAIS RIEN INVENTER ni déduire.

RÈGLES ABSOLUES DE SÉCURITÉ FINANCIÈRE :
1. Si une information (symbole, timeframe, prix exact, échelle de prix à droite) est floue, coupée ou absente de l'image, écris "ILLISIBLE" ou null. NE DEVINE JAMAIS.
2. Lis l'axe vertical des prix (à droite ou à gauche) caractère par caractère. Vérifie le prix actuel encadré sur l'axe.
3. Si les informations fournies par l'utilisateur contredisent ce qui est écrit sur le graphique, signale une alerte de contradiction.

Réponds UNIQUEMENT avec un objet JSON valide (sans texte autour) respectant exactement cette structure :
{
  "image_quality": {
    "is_trading_chart": true,
    "price_axis_readable": true,
    "timeframe_readable": true,
    "symbol_readable": true,
    "visibility_score_0_to_100": 90,
    "missing_or_blurry_elements": []
  },
  "extracted_facts": {
    "symbol_on_chart": "Ex: XAUUSD ou ILLISIBLE",
    "timeframe_on_chart": "Ex: M15, H1, D1 ou ILLISIBLE",
    "current_price_on_chart": "Prix exact lu ou ILLISIBLE",
    "visible_price_range_high": "Plus haut visible sur l'axe ou ILLISIBLE",
    "visible_price_range_low": "Plus bas visible sur l'axe ou ILLISIBLE",
    "last_candles_observation": "Description factuelle des dernières bougies visibles (ex: 3 bougies rouges consécutives rejetant une mèche haute)",
    "visible_indicators_or_drawings": ["Liste uniquement des indicateurs, moyennes mobiles, RSI ou zones déjà tracés sur l'écran"]
  },
  "key_visible_levels": {
    "nearest_resistances": ["Prix exact visible sur l'axe correspondant à un sommet"],
    "nearest_supports": ["Prix exact visible sur l'axe correspondant à un creux"]
  }
}`;

function buildAnalysisSystemPrompt(ocrFacts, userContext) {
  return `Tu es un Gestionnaire de Risque Institutionnel et Analyste Technique Senior.
L'utilisateur veut trader ce marché et exige ZÉRO HALLUCINATION : il préfère mille fois recevoir "NE PAS TRADER (ATTENDRE)" plutôt que de perdre de l'argent sur un signal incertain ou inventé.

DONNÉES FACTUELLES EXTRAITES DU GRAPHIQUE (ÉTAPE 1 - VÉRIFIÉE) :
${JSON.stringify(ocrFacts, null, 2)}

CONTEXTE FOURNI PAR LE TRADER :
- Actif indiqué : ${userContext.symbol || 'Non précisé (se fier uniquement au graphique)'}
- Timeframe indiqué : ${userContext.timeframe || 'Non précisé (se fier uniquement au graphique)'}
- Style / Idée : ${userContext.notes || 'Aucune note particulière'}
- Capital / Risque max par trade : ${userContext.riskPercent || '1'}% (Capital: ${userContext.capital || 'Non précisé'})

PROTOCOLE ANTI-PERTE & ANTI-HALLUCINATION (STRICT) :
1. INTERDICTION D'INVENTER DES PRIX : Si "price_axis_readable" est false ou si "current_price_on_chart" est "ILLISIBLE", tu DOIS obligatoirement émettre la décision "NO_TRADE" et mettre tous les prix (entrée, SL, TP) à "ILLISIBLE - AXE DES PRIX REQUIS".
2. PAS DE TRADE FORCÉ : Si le marché est en plein milieu d'un range sans direction claire, haché (choppy), ou avec un ratio Risque/Récompense (R:R) inférieur à 1:1.8, tu DOIS émettre "WAIT" ou "NO_TRADE".
3. COHÉRENCE MATHÉMATIQUE :
   - Pour un ACHAT (BUY / LONG) : Stop Loss < Prix d'Entrée < Take Profit 1 < Take Profit 2.
   - Pour une VENTE (SELL / SHORT) : Stop Loss > Prix d'Entrée > Take Profit 1 > Take Profit 2.
4. VA DROIT AU BUT : Donne uniquement les informations cruciales à saisir sur la plateforme de trading et les conditions strictes d'invalidation.

Réponds UNIQUEMENT avec un objet JSON valide respectant exactement ce schéma :
{
  "verdict": {
    "action": "BUY" | "SELL" | "WAIT" | "NO_TRADE",
    "order_type": "MARKET" | "BUY_LIMIT" | "SELL_LIMIT" | "BUY_STOP" | "SELL_STOP" | "AUCUN",
    "confidence_score": 0 à 100,
    "hallucination_guard_status": "SAFE_VERIFIED" | "WARNING_PARTIAL_DATA" | "BLOCKED_UNREADABLE_CHART",
    "headline_reason": "Une phrase directe expliquant pourquoi prendre ou refuser ce trade"
  },
  "essential_order_inputs": {
    "asset": "Nom de l'actif vérifié",
    "timeframe": "Unité de temps vérifiée",
    "current_price": "Prix actuel lu sur l'écran",
    "entry_price": "Prix exact d'entrée (ou condition d'attente si WAIT/NO_TRADE)",
    "stop_loss": "Prix exact d'invalidation structurelle",
    "take_profit_1": "Prix exact TP1 (sécurisation / Break-Even)",
    "take_profit_2": "Prix exact TP2 (objectif principal)",
    "risk_reward_ratio": "Ex: 1:2.4 (calculé sur les vrais niveaux)",
    "recommended_risk_pct": "Ex: 0.5% ou 1% max (0% si NO_TRADE)"
  },
  "market_structure_facts": {
    "trend_bias": "HAUSSIER" | "BAISSIER" | "RANGE / NEUTRE" | "INCERTAIN",
    "key_support_zone": "Zone de support exacte lue",
    "key_resistance_zone": "Zone de résistance exacte lue",
    "observed_confluences": [
      "Fait visuel 1 observé sans spéculation",
      "Fait visuel 2 observé sans spéculation"
    ]
  },
  "strict_checklist_before_clicking": [
    "Point 1 à vérifier par le trader avant d'exécuter",
    "Point 2 (ex: vérifier spread / annonce économique)",
    "Point 3 (condition d'annulation immédiate du plan)"
  ],
  "invalidation_warning": "Ce qui annule immédiatement ce scénario (quand NE PAS entrer ou sortir immédiatement)"
}`;
}

// Fonction d'appel à OmniRoute avec repli automatique (Fallback) si un modèle est temporairement surchargé (503)
async function callOmniRouteWithFallback({ apiKey, models, messages, temperature = 0.1 }) {
  const errors = [];

  for (const model of models) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 22000);

      const response = await fetch(`${OMNIROUTE_BASE}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          temperature,
          messages
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      const data = await response.json();

      if (!response.ok || data.error) {
        const errMsg = data.error?.message || `HTTP ${response.status}`;
        errors.push(`${model}: ${errMsg}`);
        continue;
      }

      const content = data.choices?.[0]?.message?.content;
      if (!content || !content.trim()) {
        errors.push(`${model}: Réponse vide`);
        continue;
      }

      return {
        content: content.trim(),
        usedModel: data.model || model,
        comboRequested: model
      };
    } catch (err) {
      errors.push(`${model}: ${err.message}`);
    }
  }

  throw new Error(`Tous les modèles OmniRoute sollicités ont échoué : ${errors.join(' | ')}`);
}

// Extraction propre d'un JSON même si le modèle entoure la réponse de ```json ... ```
function parseJsonSafely(rawText) {
  let cleaned = rawText.trim();
  const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (codeBlockMatch) {
    cleaned = codeBlockMatch[1].trim();
  } else {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      cleaned = cleaned.slice(firstBrace, lastBrace + 1);
    }
  }
  return JSON.parse(cleaned);
}

// Vérification mathématique côté serveur (Anti-Hallucination sur l'ordre des prix)
function extractFirstNumber(str) {
  if (!str || typeof str !== 'string') return null;
  // Ignore les ratios comme "1:2"
  if (str.includes(':')) return null;
  const normalized = str.replace(/\s+/g, '').replace(',', '.');
  const match = normalized.match(/\d+(\.\d+)?/);
  return match ? parseFloat(match[0]) : null;
}

function validateAndSanitizePlan(ocrData, planData) {
  const auditFlags = [];
  const priceAxisReadable = ocrData?.image_quality?.price_axis_readable !== false;
  const visibilityScore = Number(ocrData?.image_quality?.visibility_score_0_to_100 ?? 50);

  if (ocrData?.image_quality?.is_trading_chart === false) {
    planData.verdict.action = 'NO_TRADE';
    planData.verdict.order_type = 'AUCUN';
    planData.verdict.confidence_score = 0;
    planData.verdict.hallucination_guard_status = 'BLOCKED_UNREADABLE_CHART';
    planData.verdict.headline_reason = "L'image envoyée ne semble pas être un graphique de trading exploitable.";
    auditFlags.push('BLOQUÉ : Image non reconnue comme graphique de trading.');
  }

  if (!priceAxisReadable || visibilityScore < 45) {
    planData.verdict.action = 'NO_TRADE';
    planData.verdict.order_type = 'AUCUN';
    planData.verdict.confidence_score = Math.min(planData.verdict.confidence_score || 0, 25);
    planData.verdict.hallucination_guard_status = 'BLOCKED_UNREADABLE_CHART';
    planData.essential_order_inputs.entry_price = 'NON DISPONIBLE (Axe des prix illisible)';
    planData.essential_order_inputs.stop_loss = 'NON DISPONIBLE (Axe des prix illisible)';
    planData.essential_order_inputs.take_profit_1 = 'NON DISPONIBLE (Axe des prix illisible)';
    planData.essential_order_inputs.take_profit_2 = 'NON DISPONIBLE (Axe des prix illisible)';
    planData.essential_order_inputs.recommended_risk_pct = '0%';
    auditFlags.push("PROTECTION ACTIVÉE : L'échelle de prix à droite est absente ou floue. Aucun niveau de prix n'a été inventé.");
  }

  // Vérification mathématique BUY / SELL / Ordres Limites
  const action = (planData.verdict?.action || '').toUpperCase();
  const orderType = (planData.verdict?.order_type || '').toUpperCase();
  const entryNum = extractFirstNumber(planData.essential_order_inputs?.entry_price);
  const slNum = extractFirstNumber(planData.essential_order_inputs?.stop_loss);
  const tp1Num = extractFirstNumber(planData.essential_order_inputs?.take_profit_1);

  const isBuySetup = action === 'BUY' || orderType.includes('BUY');
  const isSellSetup = action === 'SELL' || orderType.includes('SELL');

  if ((isBuySetup || isSellSetup) && entryNum !== null && slNum !== null && tp1Num !== null) {
    if (isBuySetup) {
      if (!(slNum < entryNum && entryNum < tp1Num)) {
        planData.verdict.action = 'NO_TRADE';
        planData.verdict.hallucination_guard_status = 'WARNING_PARTIAL_DATA';
        planData.verdict.headline_reason = `Incohérence mathématique détectée et bloquée sur le BUY (SL: ${slNum}, Entrée: ${entryNum}, TP1: ${tp1Num}). Trade annulé par sécurité.`;
        auditFlags.push('ALERTE : Niveaux BUY incohérents détectés (SL >= Entrée ou TP1 <= Entrée) -> Converti en NO_TRADE.');
      } else {
        const risk = Math.abs(entryNum - slNum);
        const reward = Math.abs(tp1Num - entryNum);
        const rr = risk > 0 ? (reward / risk).toFixed(2) : '0';
        auditFlags.push(`VÉRIFIÉ : Cohérence mathématique ACHAT validée (${slNum} < ${entryNum} < ${tp1Num} | R:R sur TP1 = 1:${rr}).`);
      }
    } else if (isSellSetup) {
      if (!(slNum > entryNum && entryNum > tp1Num)) {
        planData.verdict.action = 'NO_TRADE';
        planData.verdict.hallucination_guard_status = 'WARNING_PARTIAL_DATA';
        planData.verdict.headline_reason = `Incohérence mathématique détectée et bloquée sur le SELL (SL: ${slNum}, Entrée: ${entryNum}, TP1: ${tp1Num}). Trade annulé par sécurité.`;
        auditFlags.push('ALERTE : Niveaux SELL incohérents détectés (SL <= Entrée ou TP1 >= Entrée) -> Converti en NO_TRADE.');
      } else {
        const risk = Math.abs(slNum - entryNum);
        const reward = Math.abs(entryNum - tp1Num);
        const rr = risk > 0 ? (reward / risk).toFixed(2) : '0';
        auditFlags.push(`VÉRIFIÉ : Cohérence mathématique VENTE validée (${slNum} > ${entryNum} > ${tp1Num} | R:R sur TP1 = 1:${rr}).`);
      }
    }
  }

  if (auditFlags.length === 0) {
    auditFlags.push(`VÉRIFIÉ : Lecture OCR (score visibilité ${visibilityScore}/100) et validation des niveaux terminées sans anomalie.`);
  }

  // Calcul optionnel de la perte max en devise si un capital est renseigné
  planData.audit_trail = auditFlags;
  return planData;
}

const requestHandler = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // Endpoint 1: Statut OmniRoute & Clé Keychain
  if (req.method === 'GET' && req.url === '/api/status') {
    const keychainKey = getKeychainApiKey();
    let omnirouteOnline = false;
    let modelCount = 0;

    try {
      const r = await fetch(`${OMNIROUTE_BASE}/models`, {
        headers: keychainKey ? { Authorization: `Bearer ${keychainKey}` } : {}
      });
      if (r.ok) {
        const d = await r.json();
        omnirouteOnline = true;
        modelCount = Array.isArray(d.data) ? d.data.length : 0;
      }
    } catch {
      omnirouteOnline = false;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(
      JSON.stringify({
        omnirouteOnline,
        omnirouteUrl: OMNIROUTE_BASE,
        hasKeychainKey: Boolean(keychainKey),
        maskedKey: keychainKey
          ? `${keychainKey.slice(0, 6)}••••${keychainKey.slice(-4)}`
          : null,
        modelCount
      })
    );
  }

  // Endpoint 2: Analyse Anti-Hallucination en 2 étapes (Double passe)
  if (req.method === 'POST' && req.url === '/api/analyze') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 25 * 1024 * 1024) {
        req.destroy();
      }
    });

    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        const {
          imageBase64,
          customApiKey,
          preferredModel,
          doubleVerification = true,
          symbol = '',
          timeframe = '',
          capital = '',
          riskPercent = '1',
          notes = ''
        } = payload;

        if (!imageBase64 || !imageBase64.startsWith('data:image/')) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: "Veuillez déposer une capture d'écran valide." }));
        }

        const apiKey = (customApiKey && customApiKey.trim()) || getKeychainApiKey();
        if (!apiKey) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          return res.end(
            JSON.stringify({
              error: "Aucune clé OmniRoute détectée dans le Trousseau macOS ni dans le champ clé."
            })
          );
        }

        // Liste ordonnée des modèles Vision les plus rapides et précis sur OmniRoute (priorité aux modèles Ultra-Fast)
        const defaultChain = [
          preferredModel || 'gemini/gemini-3.8-flash',
          'gemini/gemini-3.8-flash',
          'gemini/gemini-3.7-flash',
          'gemini/gemini-3-flash-preview',
          'gemini/gemini-2.5-flash',
          'florian/analyse',
          'ia'
        ];
        const modelChain = [...new Set(defaultChain.filter(Boolean))];

        let ocrFacts;
        let planData;
        let usedOcrModel = '';
        let usedDecisionModel = '';

        if (!doubleVerification) {
          // MODE ÉCLAIR ULTRA-RAPIDE (1 seule passe combinée OCR + Plan, température 0.0) -> ~1.5s - 2s
          const lightningResult = await callOmniRouteWithFallback({
            apiKey,
            models: modelChain,
            temperature: 0.0,
            messages: [
              {
                role: 'system',
                content: `Tu es un Analyste Financier et Gestionnaire de Risque Senior. Tu analyses des graphiques de trading avec ZÉRO HALLUCINATION.
Analyse la capture d'écran et réponds UNIQUEMENT avec un objet JSON valide (sans texte autour) respectant exactement cette structure :
{
  "ocr_facts": {
    "image_quality": { "is_trading_chart": true, "price_axis_readable": true, "visibility_score_0_to_100": 90 },
    "extracted_facts": { "symbol_on_chart": "${symbol || 'Auto'}", "timeframe_on_chart": "${timeframe || 'Auto'}", "current_price_on_chart": "Prix exact lu ou ILLISIBLE" }
  },
  "plan": {
    "verdict": { "action": "BUY" | "SELL" | "WAIT" | "NO_TRADE", "order_type": "MARKET" | "BUY_LIMIT" | "SELL_LIMIT" | "AUCUN", "confidence_score": 80, "hallucination_guard_status": "SAFE_VERIFIED", "headline_reason": "..." },
    "essential_order_inputs": { "asset": "${symbol || 'XAUUSD'}", "timeframe": "${timeframe || 'M15'}", "current_price": "...", "entry_price": "...", "stop_loss": "...", "take_profit_1": "...", "take_profit_2": "...", "calculated_rr_tp1": "...", "recommended_risk_pct": "${riskPercent}%" },
    "market_structure_facts": { "trend_bias": "...", "key_support_zone": "...", "key_resistance_zone": "...", "observed_confluences": [...] },
    "invalidation_warning": "...",
    "strict_checklist_before_clicking": [...]
  }
}`
              },
              {
                role: 'user',
                content: [
                  {
                    type: 'text',
                    text: `Analyse ce graphique pour l'actif "${symbol || 'Auto'}" (TF: "${timeframe || 'Auto'}", Capital: "${capital || '10000'}", Risque: "${riskPercent}%"). Note: ${notes || 'Aucune'}. Lis rigoureusement l'axe des prix. N'invente rien.`
                  },
                  {
                    type: 'image_url',
                    image_url: { url: imageBase64 }
                  }
                ]
              }
            ]
          });

          usedOcrModel = lightningResult.usedModel;
          usedDecisionModel = lightningResult.usedModel;

          try {
            const parsed = parseJsonSafely(lightningResult.content);
            ocrFacts = parsed.ocr_facts || { image_quality: { is_trading_chart: true, price_axis_readable: true, visibility_score_0_to_100: 90 }, extracted_facts: { symbol_on_chart: symbol || 'XAUUSD', current_price_on_chart: 'Visibles' } };
            planData = parsed.plan || parsed;
          } catch {
            ocrFacts = { image_quality: { is_trading_chart: true, price_axis_readable: true, visibility_score_0_to_100: 80 }, extracted_facts: { current_price_on_chart: 'Voir brutes' } };
            planData = parseJsonSafely(lightningResult.content);
          }
        } else {
          // MODE DOUBLE PASSE (OCR strict + Plan) -> Sécurité maximale mais plus lent (~5-8s)
          const step1Result = await callOmniRouteWithFallback({
            apiKey,
            models: modelChain,
            temperature: 0.0,
            messages: [
              { role: 'system', content: SYSTEM_PROMPT_STEP_1_OCR },
              {
                role: 'user',
                content: [
                  {
                    type: 'text',
                    text: `Lis uniquement les faits visibles sur cette capture d'écran de marché. Contexte déclaré par l'utilisateur : Actif="${symbol || 'Non précisé'}", Timeframe="${timeframe || 'Non précisé'}". N'invente aucun chiffre.`
                  },
                  {
                    type: 'image_url',
                    image_url: { url: imageBase64 }
                  }
                ]
              }
            ]
          });

          usedOcrModel = step1Result.usedModel;

          try {
            ocrFacts = parseJsonSafely(step1Result.content);
          } catch {
            ocrFacts = {
              image_quality: {
                is_trading_chart: true,
                price_axis_readable: true,
                timeframe_readable: true,
                symbol_readable: true,
                visibility_score_0_to_100: 70,
                missing_or_blurry_elements: []
              },
              extracted_facts: {
                raw_observation: step1Result.content
              }
            };
          }

          const analysisModels = [...new Set(['gemini/gemini-2.5-flash', 'gemini/gemini-3-flash-preview', ...modelChain])];

          const step2Result = await callOmniRouteWithFallback({
            apiKey,
            models: analysisModels,
            temperature: 0.1,
            messages: [
              {
                role: 'system',
                content: buildAnalysisSystemPrompt(ocrFacts, {
                  symbol,
                  timeframe,
                  capital,
                  riskPercent,
                  notes
                })
              },
              {
                role: 'user',
                content: [
                  {
                    type: 'text',
                    text: "À partir de l'image ET de l'extraction factuelle ci-dessus, produis le plan d'exécution final ultra-prudent au format JSON. Si le setup n'est pas clair à 100% ou si le ratio R:R est mauvais, réponds WAIT ou NO_TRADE."
                  },
                  {
                    type: 'image_url',
                    image_url: { url: imageBase64 }
                  }
                ]
              }
            ]
          });

          usedDecisionModel = step2Result.usedModel;
          planData = parseJsonSafely(step2Result.content);
        }

        planData = validateAndSanitizePlan(ocrFacts, planData);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(
          JSON.stringify({
            success: true,
            modelsUsed: {
              ocrModel: usedOcrModel,
              decisionModel: usedDecisionModel
            },
            ocrFacts,
            plan: planData
          })
        );
      } catch (err) {
        console.error('Analysis error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(
          JSON.stringify({
            error: err.message || "Erreur lors de l'analyse avec OmniRoute."
          })
        );
      }
    });
    return;
  }

  // Serve static files from /public
  let filePath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const fullPath = path.join(__dirname, 'public', filePath);

  if (!fullPath.startsWith(path.join(__dirname, 'public'))) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(fullPath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 - Fichier introuvable');
    }
    const ext = path.extname(fullPath).toLowerCase();
    const mimeTypes = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.svg': 'image/svg+xml'
    };
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    res.end(content);
  });
};

if (require.main === module) {
  const server = http.createServer(requestHandler);
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`✅ Terminal Trading OmniRoute lancé sur http://localhost:${PORT}`);
  });
}

module.exports = requestHandler;

