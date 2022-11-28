FROM node:18.12.1-bullseye-slim

RUN mkdir -p /app
COPY ./package.json /app/package.json
RUN cd /app && npm install --omit=dev
ENV NODE_PATH=/app/node_modules

ENTRYPOINT ["node", "/app/server.js"]
