FROM node:20-bookworm-slim

WORKDIR /app

COPY . ./

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "server.cjs"]
