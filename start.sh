#!/bin/bash

echo "================================================="
echo "🚀 Start Crime Station PodcastFlow & Whisper API"
echo "================================================="
echo ""

# 1. Start de Whisper API (Python) op de achtergrond
echo "-> [1/2] Starting Whisper API (Python)..."
cd "../Transcriptie Agent" || { echo "❌ Map 'Transcriptie Agent' niet gevonden!"; exit 1; }

if [ -f "venv/bin/activate" ]; then
    source venv/bin/activate
else
    echo "⚠️ Geen venv gevonden, draait op systeem-python."
fi

# Start uvicorn op de achtergrond en bewaar het process ID
uvicorn api:app --host 0.0.0.0 --port 8001 &
WHISPER_PID=$!
echo "✓ Whisper API draait op de achtergrond (Port 8001 | PID: $WHISPER_PID)"
echo ""

# 2. Ga terug en start de PodcastFlow Interface (Node.js)
cd "../PodcastFlow 2" || exit
echo "-> [2/2] Starting PodcastFlow Interface (Node.js)..."

# Zorg ervoor dat de achtergrond-taak (Whisper) netjes wordt gestopt als we dit script afsluiten (bijv. met CTRL+C)
trap "echo '\n🛑 Afsluiten... Whisper API wordt gestopt.'; kill $WHISPER_PID; exit" SIGINT SIGTERM

# Start de web server in de voorgrond, zodat we de Vite/TypeScript logs kunnen zien
npm run dev
