FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
       fontconfig fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*
# fontconfig + fonts-dejavu-core: the slim base image ships with no fonts at
# all, so sharp's SVG rasterizer (librsvg) can't draw any <text> - every
# glyph renders as a tofu box. Only logo-preview.cjs needs real text in an
# SVG; the existing wallet-pass strip rendering never hit this because it's
# shapes/icons only.

WORKDIR /app

# Install only API deps (keeps docker build independent from the monorepo workspaces)
COPY package.json ./
RUN npm install --omit=dev

COPY . ./
RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "server.cjs"]
