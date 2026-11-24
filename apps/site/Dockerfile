# Vitrine getanzar.com : fichiers statiques, servis par Caddy
FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY index.html styles.css telecharger.js icone.png /srv/
COPY telecharger /srv/telecharger

# Sans root (audit 23/11/2026 #13) : utilisateur dédié. Le port 80 reste utilisable grâce au
# sysctl net.ipv4.ip_unprivileged_port_start du docker-compose, sans aucune capacité système.
RUN addgroup -S web && adduser -S -D -H -G web -s /sbin/nologin web \
    && mkdir -p /data /config && chown -R web:web /data /config
USER web
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
