#!/bin/sh
set -eu
cd /workspace
if [ -f /workspace/attachments/env.txt ]; then
  set -a
  # Server-only payment settings supplied by the owner. Not read by the browser bundle.
  . /workspace/attachments/env.txt
  set +a
fi
node scripts/preview.mjs stop || true
if curl -sf -o /dev/null --max-time 2 http://127.0.0.1:8080/; then
  exit 0
fi
npm run dev >>/tmp/app-startup.log 2>&1 &
