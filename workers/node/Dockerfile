FROM node:22.11.0-bookworm-slim

RUN mkdir -p /app
COPY ./package.json /app/package.json
RUN cd /app && npm install --omit=dev
ENV NODE_PATH=/app/node_modules

ENTRYPOINT ["node", "--env-file=/app/.env", "/app/server.js"]
