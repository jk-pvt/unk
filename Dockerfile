FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependency specifications
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy project source files
COPY . .

# Build frontend asset bundle into dist/
RUN npm run build

# --- Production stage ---
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=6002
ENV HOST=0.0.0.0

# Copy node_modules and built assets from builder stage
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/data ./data

# Expose backend port 6002
EXPOSE 6002

# Start backend server
CMD ["node", "server/index.js"]
