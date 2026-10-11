FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev || npm install

COPY server.js ./

EXPOSE 4000
EXPOSE 4001

CMD ["npm", "start"]

