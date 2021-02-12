FROM node:14.15.4-stretch-slim

RUN mkdir -p /app
COPY ./package.json /app/package.json
RUN cd /app && npm install --production
ENV NODE_PATH=/app/node_modules

ENTRYPOINT ["node", "/app/server.js"]
