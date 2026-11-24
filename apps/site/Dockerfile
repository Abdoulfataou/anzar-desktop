# Vitrine getanzar.com : pages générées par build.py (FR/EN), servies par Caddy

# 1) Génération des pages statiques (Python standard, aucune dépendance)
FROM python:3.12-alpine AS generation
WORKDIR /site
COPY build.py ./
COPY i18n i18n
COPY templates templates
COPY static static
COPY data data
RUN python3 build.py --out /dist

# 2) Service
FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=generation /dist /srv/

# Sans root (audit 23/11/2026 #13) : utilisateur dédié. Le port 80 reste utilisable grâce au
# sysctl net.ipv4.ip_unprivileged_port_start du docker-compose, sans aucune capacité système.
# L'image officielle donne à caddy la capacité « bind port 80 » (setcap). Avec cap_drop: ALL et
# no-new-privileges, le noyau refuse alors de lancer le binaire (« operation not permitted ») :
# on retire cette capacité, inutile ici grâce au sysctl.
RUN apk add --no-cache libcap && setcap -r /usr/bin/caddy && apk del libcap
RUN addgroup -S web && adduser -S -D -H -G web -s /sbin/nologin web \
    && mkdir -p /data /config && chown -R web:web /data /config
USER web
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1/fr/ || exit 1
