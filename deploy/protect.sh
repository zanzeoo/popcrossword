#!/bin/bash
# Protège par identifiant + mot de passe (basic auth Caddy) ce qui n'est pas destiné aux joueurs :
# les prototypes (/proto/*). Le jeu, le temps réel et /api/health restent publics : on rejoint une
# partie avec son seul code. L'API d'édition (/api/admin/*, /api/moderation/*) se protège elle-même
# par ADMIN_TOKEN ; elle ne peut pas être derrière le basic auth, les deux utilisent l'en-tête
# Authorization.
# Relancer le script change le mot de passe ; avec --garder, il conserve ceux déjà en place.
# Usage : sudo bash deploy/protect.sh [--garder]
set -euo pipefail

DOMAIN=popcrossword.zanzeoo.fr
PORT=3100
CADDYFILE=/etc/caddy/Caddyfile

if [ "${1:-}" = "--garder" ]; then
  # Reprend l'identifiant et le hash du bloc actuel.
  read -r AUTH_USER AUTH_HASH < <(awk '/basic_auth/ {f=1; next} f && NF==2 && $2 ~ /^\$2/ {print $1, $2; exit}' "$CADDYFILE")
  [ -n "${AUTH_USER:-}" ] && [ -n "${AUTH_HASH:-}" ] || { echo "Aucun identifiant existant à conserver."; exit 1; }
else
read -rp "Identifiant : " AUTH_USER
[[ "$AUTH_USER" =~ ^[A-Za-z0-9_.-]+$ ]] || { echo "Identifiant invalide (lettres, chiffres, _ . -)"; exit 1; }
read -rsp "Mot de passe : " PASS1; echo
read -rsp "Confirmation : " PASS2; echo
[ "$PASS1" = "$PASS2" ] || { echo "Les mots de passe diffèrent."; exit 1; }
[ ${#PASS1} -ge 10 ] || { echo "10 caractères minimum."; exit 1; }

AUTH_HASH=$(printf '%s\n%s\n' "$PASS1" "$PASS1" | caddy hash-password | tail -1)
[[ "$AUTH_HASH" == '$2'* ]] || { echo "Échec du hachage du mot de passe."; exit 1; }
unset PASS1 PASS2
fi

cp "$CADDYFILE" "$CADDYFILE.bak.$(date +%Y%m%d%H%M%S)"

# Remplace tout le bloc du domaine par la version protégée.
DOMAIN=$DOMAIN PORT=$PORT AUTH_USER=$AUTH_USER AUTH_HASH=$AUTH_HASH python3 - "$CADDYFILE" <<'PY'
import os, re, sys
path = sys.argv[1]
d, port, user, h = (os.environ[k] for k in ("DOMAIN", "PORT", "AUTH_USER", "AUTH_HASH"))
block = f"""{d} {{
    @prive path /proto /proto/*
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
echo "Protection active sur https://$DOMAIN/proto/ ; le reste du site est public."
