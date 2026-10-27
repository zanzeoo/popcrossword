#!/bin/bash
# Installation de l'infrastructure PopCrossword sur le VPS Debian.
# À lancer une fois, avec sudo : sudo bash deploy/install.sh
# Le script peut être relancé sans casse.
set -euo pipefail

APP_USER=zanzeoo
APP_DIR=/home/$APP_USER/popcrossword
ENV_FILE=$APP_DIR/server/.env
DOMAIN=popcrossword.zanzeoo.fr
PORT=3100

echo "== Node.js 22 LTS (dépôt NodeSource) ; Node 20 n'est plus maintenu"
sed -i 's#node_20.x#node_22.x#' /etc/apt/sources.list.d/nodesource.sources

echo "== Paquets : Node.js, PostgreSQL et Redis"
apt-get update -q
apt-get install -y -q nodejs postgresql redis-server

echo "== Redis : écoute locale uniquement"
sed -i 's/^#\? *bind .*/bind 127.0.0.1 -::1/' /etc/redis/redis.conf
systemctl enable --now redis-server
systemctl restart redis-server

echo "== PostgreSQL : rôle et base popcrossword"
systemctl enable --now postgresql
if [ ! -f "$ENV_FILE" ]; then
  DB_PASS=$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32)
  cat > "$ENV_FILE" <<ENV
PORT=$PORT
DATABASE_URL=postgres://popcrossword:$DB_PASS@127.0.0.1:5432/popcrossword
REDIS_URL=redis://127.0.0.1:6379
ENV
  chown $APP_USER:$APP_USER "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "DO \$\$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'popcrossword') THEN
      CREATE ROLE popcrossword LOGIN PASSWORD '$DB_PASS';
    ELSE
      ALTER ROLE popcrossword PASSWORD '$DB_PASS';
    END IF; END \$\$;"
fi
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='popcrossword'" | grep -q 1 \
  || sudo -u postgres createdb -O popcrossword popcrossword

echo "== Service systemd"
cp "$APP_DIR/deploy/popcrossword.service" /etc/systemd/system/popcrossword.service
systemctl daemon-reload
systemctl enable popcrossword

echo "== Caddy : $DOMAIN -> localhost:$PORT"
if ! grep -q "^$DOMAIN" /etc/caddy/Caddyfile; then
  cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak.$(date +%Y%m%d%H%M%S)
  printf '\n%s {\n    reverse_proxy localhost:%s\n}\n' "$DOMAIN" "$PORT" >> /etc/caddy/Caddyfile
fi
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl reload caddy

echo "== Terminé. Étapes suivantes (sans sudo) : cd $APP_DIR/server && npm install && npm run migrate"
echo "   puis : sudo systemctl start popcrossword"
