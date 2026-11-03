# GFX References — 봇 + API + 웹사이트를 한 컨테이너로 실행
FROM node:22-slim AS build
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/ ./
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
ENV NODE_ENV=production \
    WEB_DIR=/app/web \
    DATA_DIR=/data \
    PORT=3000
WORKDIR /app/server
COPY --from=build /app/server/node_modules ./node_modules
COPY --from=build /app/server/dist ./dist
COPY server/package.json ./
COPY web/ /app/web/
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
