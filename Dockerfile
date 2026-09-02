FROM node:20-bookworm-slim

WORKDIR /app

COPY backend/package.json backend/package-lock.json ./backend/
RUN npm --prefix backend ci --omit=dev

COPY backend ./backend
COPY vision-config.json ./vision-config.json

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=80
EXPOSE 80

CMD ["node", "backend/api-server.js"]
