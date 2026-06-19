FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY services/payments/index.js ./index.js
EXPOSE 3002
CMD ["node", "index.js"]
