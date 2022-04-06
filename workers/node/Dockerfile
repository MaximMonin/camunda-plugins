FROM node:16.14.2-bullseye-slim

RUN mkdir -p /app
COPY ./package.json /app/package.json
RUN cd /app && npm install --production
ENV NODE_PATH=/app/node_modules

ENTRYPOINT ["node", "/app/server.js"]
