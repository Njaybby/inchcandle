# Builds the attester and the relay from the repository root: docker build -f relay/Dockerfile .
# The relay shares protocol code with the app under app/src/lib. Those files resolve their packages from /srv/node_modules, so the app's own dependencies are not installed.
FROM node:22-slim
WORKDIR /srv
COPY relay/package.json relay/package-lock.json ./
RUN npm ci --omit=dev
COPY app/src/lib ./app/src/lib
COPY relay/src ./relay/src
WORKDIR /srv/relay
ENV NODE_ENV=production
CMD ["npx", "tsx", "src/attester.ts"]
