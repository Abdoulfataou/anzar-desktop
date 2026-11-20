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
