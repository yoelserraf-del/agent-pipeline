# Agent Pipeline Isolated

Standalone extraction of the `AgentPipeline` mini-app from the original project.

## What it is

A browser-based AI sales pipeline for small-business website outreach:

- Research prospects with Claude
- Generate pitch emails
- Send emails with Resend
- Generate draft/final HTML websites
- Track lead stages from prospects to live

## Run locally

```bash
npm install
npm run dev
```

Open the Vite URL shown in the terminal.

## Build

```bash
npm run build
npm run preview
```

## Important security note

This prototype stores Claude and Resend API keys in browser `localStorage` and calls APIs directly from the frontend. Do not deploy this as-is for production. Use a backend/proxy for API keys.
