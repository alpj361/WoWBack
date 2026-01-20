# Usar Node.js oficial como base
FROM node:20-alpine

# Establecer directorio de trabajo
WORKDIR /app

# Copiar archivos de dependencias
COPY package*.json ./

# Instalar dependencias Node.js
RUN npm ci --only=production && npm cache clean --force

# Crear usuario no-root para seguridad
RUN addgroup -g 1001 -S nodejs && \
    adduser -S eventanalyzer -u 1001

# Copiar código fuente
COPY --chown=eventanalyzer:nodejs . .

# Exponer puerto
EXPOSE 3001

# Cambiar a usuario no-root
USER eventanalyzer

# Comando de inicio
CMD ["npm", "start"]
