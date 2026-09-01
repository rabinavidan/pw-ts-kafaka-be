FROM node:20.20.0-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY mock-server.js .
EXPOSE 3000
CMD ["node", "mock-server.js"]
