FROM python:3.11-slim

# Metadata
LABEL maintainer="ANZAR" \
      description="ANZAR Backend — Secure AI Proxy" \
      version="1.2.0"

WORKDIR /app

# System dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Python dependencies (cached layer)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source code
COPY . .

# Create directories and non-root user
RUN mkdir -p data projects \
    && groupadd -r anzar && useradd -r -g anzar -d /app -s /sbin/nologin anzar \
    && chown -R anzar:anzar /app

# Switch to non-root user
USER anzar

# Railway injects PORT at runtime
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD curl -f http://localhost:${PORT:-8000}/health || exit 1

# Start server — Railway provides $PORT
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
