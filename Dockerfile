FROM node:22-slim
WORKDIR /app

# better-sqlite3 richiede build tools per la compilazione nativa
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --omit=dev
COPY . .

# La cartella data (SQLite) va montata come volume per persistere
RUN mkdir -p data
EXPOSE 3000
CMD ["node", "src/server.js"]
