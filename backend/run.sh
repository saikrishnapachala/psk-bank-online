#!/usr/bin/env bash
# Builds and runs the banking service with only a JDK (21+). No Maven/Gradle downloads needed.
# Usage: ./run.sh            start the service
#        ./run.sh --check    live-mode smoke test (token + account inquiries), then exit
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -f .env ]; then cp .env.example .env; echo "Created backend/.env from .env.example (mock mode)."; fi
rm -rf out
javac -d out $(find src -name '*.java')
exec java -cp out com.pskbank.demo.App "$@"
