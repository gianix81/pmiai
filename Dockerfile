FROM node:22-slim
WORKDIR /app

# Nessun build tool: SQLite è integrato in Node (node:sqlite, richiede Node >= 22.5)
COPY package*.json ./
RUN npm install --omit=dev --omit=optional
COPY . .

# La cartella data (SQLite) va montata come volume per persistere
RUN mkdir -p data
EXPOSE 3000
CMD ["node", "src/server.js"]
