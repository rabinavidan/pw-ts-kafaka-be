FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY services/notifications/index.js ./index.js
EXPOSE 3004
CMD ["node", "index.js"]
