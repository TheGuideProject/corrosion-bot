
# CorrosionBot (POC) — Netlify

Assistente per analisi immagini di corrosione con suggerimento ciclo verniciante PPG.
Front‑end React + Tailwind. Backend Netlify Functions che chiama OpenAI Vision.

## Prerequisiti
- Account Netlify (piano free va bene per la POC)
- Node 18+
- **OPENAI_API_KEY** (non metterla nei file, usa le variabili su Netlify)

## Setup locale
```bash
npm i
npx netlify dev
```
Apri http://localhost:8888

## Deploy su Netlify
1. Carica questo zip su una nuova repo Git (GitHub/GitLab/Bitbucket) **oppure** usa "Deploy with Netlify" trascinando la cartella dal PC (drag&drop).
2. Su Netlify vai su: **Site settings → Environment variables** e aggiungi:
   - `OPENAI_API_KEY` = la tua chiave
3. Deploy. Fine.

## Dove cambiare le regole prodotto
`netlify/functions/analyze.mjs` — oggetto LIB e funzione pickCycle.

## Disclaimer
Strumento sperimentale. Non sostituisce un ispettore certificato.
Verificare sempre con ispezione e TDS/PSDS.
