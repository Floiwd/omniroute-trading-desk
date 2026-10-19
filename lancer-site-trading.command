#!/bin/zsh
cd "$(dirname "$0")"
echo "🚀 Démarrage d'OmniRoute Trading Desk sur http://localhost:3080 ..."
open "http://localhost:3080" &
node server.js
