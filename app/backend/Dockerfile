# ── Stage 1: build the React frontend ────────────────────────────────────────
FROM node:20-alpine AS frontend-builder

WORKDIR /frontend

COPY app/frontend/package*.json ./
RUN npm install

COPY app/frontend/ ./
# VITE_API_BASE_URL defaults to /api/v1 (same-origin) — no env override needed.
RUN npm run build

# ── Stage 2: Django / Daphne backend ─────────────────────────────────────────
FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY app/backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/backend/ .

# Bundle the compiled React app so WhiteNoise can serve it alongside /static/
COPY --from=frontend-builder /frontend/dist ./staticfiles/frontend

RUN addgroup --system appgroup && adduser --system --ingroup appgroup appuser \
    && chmod +x /app/start.sh
USER appuser

EXPOSE 8000
CMD ["/app/start.sh"]
