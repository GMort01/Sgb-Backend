FROM node:22-trixie-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && mkdir -p /app/data
COPY . .
EXPOSE 3000
ENV DB_PATH=/app/data/biblioteca.db
CMD ["npm", "start"]