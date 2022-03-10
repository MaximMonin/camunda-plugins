FROM node:14.19.0-buster-slim

RUN mkdir -p /app
COPY ./package.json /app/package.json
RUN cd /app && npm install --production
ENV NODE_PATH=/app/node_modules

ENTRYPOINT ["node", "/app/server.js"]
