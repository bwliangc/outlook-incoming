FROM node:22-slim AS build

WORKDIR /app/server

COPY server/package*.json ./
RUN npm ci

COPY server/tsconfig.json ./
COPY server/src ./src
RUN npm run build

FROM node:22-slim

WORKDIR /app/server

COPY server/package*.json ./
RUN npm ci --omit=dev

COPY --from=build /app/server/dist ./dist
COPY web /app/web

ENV HOTMAIL_HELPER_HOST=0.0.0.0
ENV HOTMAIL_HELPER_PORT=17345
ENV HOTMAIL_HELPER_WEB_DIR=/app/web

EXPOSE 17345

CMD ["node", "dist/server.js"]
