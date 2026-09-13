# Сборка: дела приходят отдельным контекстом «cases» (репозиторий red-thread-secret).
#   docker compose up -d --build                       — контекст берётся из CASES_DIR в .env
#   docker build --build-context cases=../red-thread-secret -t red-thread .
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
COPY --from=cases . /cases
ENV CASES_DIR=/cases
RUN npx nuxi prepare && npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production \
    RUNNING_IN_DOCKER=1 \
    PORT=3000 \
    CASES_DIR=/app/cases \
    MEDIA_DIR=/app/media \
    DATA_DIR=/app/.data
COPY --from=build /app/.output ./.output
COPY --from=build /app/media ./media
COPY --from=cases . ./cases
# метка сборки: открытые вкладки экрана и телефонов видят новую и перезагружаются сами
RUN date +%s > /app/build-id && mkdir -p /app/.data && chown -R node:node /app/.data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD wget -qO- http://127.0.0.1:3000/api/config > /dev/null || exit 1
CMD ["node", ".output/server/index.mjs"]
