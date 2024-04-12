FROM node:20.12.1-bookworm-slim

RUN mkdir -p /app
COPY ./package.json /app/package.json
RUN cd /app && npm install --omit=dev
ENV NODE_PATH=/app/node_modules

ENTRYPOINT ["node", "--env-file=/app/.env", "/app/server.js"]
