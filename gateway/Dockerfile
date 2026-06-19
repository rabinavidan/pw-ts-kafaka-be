FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY gateway/index.js ./index.js
EXPOSE 3000
CMD ["node", "index.js"]
