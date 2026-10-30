---
name: office
description: Open the devcrew office, a live 3D view of which agents are working on what. Starts it if needed. Pass "demo" to play a demo run.
argument-hint: "[demo]"
disable-model-invocation: true
allowed-tools: Bash(node *)
---

# devcrew office

1. Make sure the office is running. Run:
   `node "${CLAUDE_PLUGIN_ROOT}/office/start.js"`
   It prints the URL, or the reason it could not start.
2. Tell the user to open the printed URL (default http://localhost:4317) in their browser. It shows every Claude Code session on this computer that has devcrew installed. The office runs only on this computer and records no prompt text or file contents.
3. If `$ARGUMENTS` is `demo`, also run `node "${CLAUDE_PLUGIN_ROOT}/office/demo.js"` in the background. It plays a scripted demo run of about 45 seconds, labelled "Demo" in the office.
