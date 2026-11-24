# Panneau admin ANZAR : build Vite, puis fichiers statiques servis par Caddy (léger, sans Node en production)
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev --no-audit --no-fund
COPY . .
ARG VITE_BACKEND_URL=https://anzar-api.issalanhub.com
ENV VITE_BACKEND_URL=$VITE_BACKEND_URL
RUN npm run build:web

FROM caddy:2-alpine
COPY --from=build /app/dist /srv
COPY Caddyfile /etc/caddy/Caddyfile

# Sans root (audit 23/11/2026 #13) : utilisateur dédié. Le port 80 reste utilisable grâce au
# sysctl net.ipv4.ip_unprivileged_port_start du docker-compose, sans aucune capacité système.
# L'image officielle donne à caddy la capacité « bind port 80 » (setcap). Avec cap_drop: ALL et
# no-new-privileges, le noyau refuse alors de lancer le binaire (« operation not permitted ») :
# on retire cette capacité, inutile ici grâce au sysctl.
RUN apk add --no-cache libcap && setcap -r /usr/bin/caddy && apk del libcap
RUN addgroup -S web && adduser -S -D -H -G web -s /sbin/nologin web \
    && mkdir -p /data /config && chown -R web:web /data /config
USER web
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
