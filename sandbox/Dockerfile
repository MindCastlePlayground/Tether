FROM mcr.microsoft.com/playwright:v1.64.0-noble

USER root
WORKDIR /app

COPY prototype/node_modules /app/prototype/node_modules
COPY prototype/dist /app/prototype/dist
COPY prototype/extension /app/prototype/extension
COPY prototype/package.json /app/prototype/package.json
COPY sandbox /app/sandbox

RUN mkdir -p /data
VOLUME ["/data"]

CMD ["xvfb-run", "-a", "node", "/app/sandbox/server.mjs"]
