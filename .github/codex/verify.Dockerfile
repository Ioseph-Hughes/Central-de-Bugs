FROM node:22-bookworm@sha256:0e5f906573693feaa1e21057ebdcfdb5bd5021f050b2dc7c9deceb629c7da2a8
WORKDIR /workspace
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts && npx playwright install --with-deps chromium
COPY . .
ENV CI=1
# O código proposto só roda no docker run, sem rede, segredos ou mounts do host.
CMD ["sh", "-c", "npm test && npm run test:sql && npm run build && node scripts/bugfix-workflow.cjs newTests"]
