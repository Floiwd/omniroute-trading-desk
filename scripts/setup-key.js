#!/usr/bin/env node
// Configure une clé API Google Gemini et l'enregistre dans le Trousseau macOS (service "gemini-api-key").
// Usage : npm run setup-key   (ou : node scripts/setup-key.js)
// La clé n'est jamais écrite dans le projet ni dans Git.

const { execFileSync } = require('child_process');
const readline = require('readline');

const SERVICE = 'gemini-api-key';
const BASE = 'https://generativelanguage.googleapis.com/v1beta';

function askHidden(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = str => {
      if (str.includes(question)) rl.output.write(str);
      else rl.output.write('*'.repeat(str.length > 1 ? 0 : 1));
    };
    rl.question(question, answer => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

async function testModel(key, model) {
  const t = Date.now();
  try {
    const r = await fetch(`${BASE}/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ parts: [{ text: 'Réponds uniquement: OK' }] }] }),
      signal: AbortSignal.timeout(30000)
    });
    const d = await r.json().catch(() => ({}));
    return { ok: r.ok, ms: Date.now() - t, error: d.error?.message };
  } catch (e) {
    return { ok: false, ms: Date.now() - t, error: e.message };
  }
}

(async () => {
  console.log('\n🔑 Configuration de la clé API Gemini (analyses graphiques)\n');
  console.log('1. Ouvrez https://aistudio.google.com/apikey et créez une clé.');
  console.log('2. Pour la puissance maximale (Gemini 4 Argon / Pro, quotas élevés, pas de file d\'attente),');
  console.log('   activez la facturation sur le projet de la clé (niveau payant "Tier 1" ou plus).\n');

  const key = process.env.GEMINI_API_KEY_INPUT || (await askHidden('Collez votre clé (commence par AIza… ou AQ.…) : '));
  if (!/^(AIza|AQ\.)[0-9A-Za-z_.-]{20,}$/.test(key)) {
    console.error('❌ Format de clé invalide (une clé Gemini commence par "AIza" ou "AQ.").');
    process.exit(1);
  }

  console.log('\n⏳ Vérification des modèles accessibles avec cette clé…');
  const models = ['gemini-3.8-flash', 'gemini-3-flash-preview', 'gemini-4-argon', 'gemini-3.1-pro-preview'];
  const results = await Promise.all(models.map(m => testModel(key, m).then(r => ({ m, ...r }))));
  results.forEach(r => {
    console.log(`   ${r.ok ? '✅' : '⛔'} ${r.m.padEnd(24)} ${r.ok ? `${(r.ms / 1000).toFixed(1)} s` : (r.error || '').slice(0, 90)}`);
  });

  if (!results.some(r => r.ok)) {
    console.error('\n❌ Aucun modèle accessible : clé invalide, révoquée ou projet bloqué. Rien n\'a été enregistré.');
    process.exit(1);
  }
  const pro = results.filter(r => /argon|pro/.test(r.m)).some(r => r.ok);
  if (!pro) {
    console.log('\n⚠️  Les modèles haut de gamme (Gemini 4 Argon / Pro) sont refusés : activez la facturation');
    console.log('   sur ce projet pour le mode "Ultra". Les modes "Rapide" et "Précis" fonctionneront.');
  }

  if (process.platform === 'darwin') {
    execFileSync('security', ['add-generic-password', '-U', '-a', process.env.USER || 'trading', '-s', SERVICE, '-w', key], {
      stdio: 'ignore'
    });
    console.log(`\n✅ Clé enregistrée dans le Trousseau macOS (service "${SERVICE}").`);
  } else {
    console.log('\nℹ️  Hors macOS : exportez la variable GEMINI_API_KEY avant de lancer le serveur.');
  }
  console.log('   Sur Vercel : Project → Settings → Environment Variables → GEMINI_API_KEY = votre clé.');
  console.log('   Relancez ensuite le serveur : npm start\n');
})();
