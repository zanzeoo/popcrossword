#!/bin/bash
# Protège popcrossword.zanzeoo.fr par identifiant + mot de passe (basic auth Caddy).
# /api/health reste public pour la supervision. Relancer le script change le mot de passe.
# Usage : sudo bash deploy/protect.sh
set -euo pipefail

DOMAIN=popcrossword.zanzeoo.fr
PORT=3100
CADDYFILE=/etc/caddy/Caddyfile

read -rp "Identifiant : " AUTH_USER
[[ "$AUTH_USER" =~ ^[A-Za-z0-9_.-]+$ ]] || { echo "Identifiant invalide (lettres, chiffres, _ . -)"; exit 1; }
read -rsp "Mot de passe : " PASS1; echo
read -rsp "Confirmation : " PASS2; echo
[ "$PASS1" = "$PASS2" ] || { echo "Les mots de passe diffèrent."; exit 1; }
[ ${#PASS1} -ge 10 ] || { echo "10 caractères minimum."; exit 1; }

AUTH_HASH=$(printf '%s\n%s\n' "$PASS1" "$PASS1" | caddy hash-password | tail -1)
[[ "$AUTH_HASH" == '$2'* ]] || { echo "Échec du hachage du mot de passe."; exit 1; }
unset PASS1 PASS2

cp "$CADDYFILE" "$CADDYFILE.bak.$(date +%Y%m%d%H%M%S)"

# Remplace tout le bloc du domaine par la version protégée.
DOMAIN=$DOMAIN PORT=$PORT AUTH_USER=$AUTH_USER AUTH_HASH=$AUTH_HASH python3 - "$CADDYFILE" <<'PY'
import os, re, sys
path = sys.argv[1]
d, port, user, h = (os.environ[k] for k in ("DOMAIN", "PORT", "AUTH_USER", "AUTH_HASH"))
block = f"""{d} {{
    @prive not path /api/health
    basic_auth @prive {{
        {user} {h}
    }}
    reverse_proxy localhost:{port}
}}
"""
s = open(path).read()
s, n = re.subn(rf"^{re.escape(d)} \{{\n.*?^\}}\n?", lambda m: block, s, flags=re.M | re.S)
if n != 1:
    sys.exit(f"Bloc {d} introuvable dans {path}")
open(path, "w").write(s)
PY

caddy validate --config "$CADDYFILE" --adapter caddyfile
systemctl reload caddy
echo "Protection active sur https://$DOMAIN (sauf /api/health)."
