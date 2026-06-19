FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY services/events/index.js ./index.js
EXPOSE 3003
CMD ["node", "index.js"]
