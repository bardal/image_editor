#!/bin/bash
# Deploy image editor to barney.daltons.net/image_editor
#
# Usage: ./deploy.sh
#
# Configure by creating a .env file (see .env.example):
#   DEPLOY_HOST     - SSH/FTP host (default: daltons.net)
#   DEPLOY_USER     - cPanel username
#   DEPLOY_PATH     - Remote path from home dir (default: public_html/barney/image_editor)
#   DEPLOY_METHOD   - "ssh" or "ftp" (default: ssh)
#   DEPLOY_PORT     - SSH port (default: 22)

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Load .env if present
if [ -f "$SCRIPT_DIR/.env" ]; then
    source "$SCRIPT_DIR/.env"
fi

HOST="${DEPLOY_HOST:-daltons.net}"
USER="${DEPLOY_USER:?Set DEPLOY_USER in .env or environment}"
REMOTE_PATH="${DEPLOY_PATH:-public_html/barney/image_editor}"
METHOD="${DEPLOY_METHOD:-ssh}"
PORT="${DEPLOY_PORT:-22}"

echo "Deploying to ${USER}@${HOST}:~/${REMOTE_PATH} via ${METHOD}..."

if [ "$METHOD" = "ssh" ]; then
    ssh -p "$PORT" "${USER}@${HOST}" "mkdir -p ~/${REMOTE_PATH}"
    scp -P "$PORT" \
        "$SCRIPT_DIR/index.html" \
        "$SCRIPT_DIR/manifest.json" \
        "$SCRIPT_DIR/sw.js" \
        "$SCRIPT_DIR/icon.svg" \
        "$SCRIPT_DIR/icon-192.png" \
        "$SCRIPT_DIR/icon-512.png" \
        "${USER}@${HOST}:~/${REMOTE_PATH}/"
elif [ "$METHOD" = "ftp" ]; then
    if ! command -v lftp &>/dev/null; then
        echo "Error: lftp not installed. Install with: apt install lftp / brew install lftp"
        exit 1
    fi
    lftp -u "${USER},${DEPLOY_PASS:?Set DEPLOY_PASS for FTP}" "${HOST}" <<FTPCMDS
mkdir -p ${REMOTE_PATH}
put -O ${REMOTE_PATH} $SCRIPT_DIR/index.html
put -O ${REMOTE_PATH} $SCRIPT_DIR/manifest.json
put -O ${REMOTE_PATH} $SCRIPT_DIR/sw.js
put -O ${REMOTE_PATH} $SCRIPT_DIR/icon.svg
put -O ${REMOTE_PATH} $SCRIPT_DIR/icon-192.png
put -O ${REMOTE_PATH} $SCRIPT_DIR/icon-512.png
bye
FTPCMDS
else
    echo "Unknown method: $METHOD (use 'ssh' or 'ftp')"
    exit 1
fi

echo "Done! https://barney.daltons.net/image_editor/"
