# Deployable Piko Python service (Qwen /analyze/wav + sounds API).
# Keeps SILICONFLOW_* and SUPABASE_* on the server — never in the iPad frontend.
#
# Build:
#   docker build -t piko-python ./python-service
# Run (example):
#   docker run --rm -p 8001:8001 \
#     -e SILICONFLOW_API_KEY=... \
#     -e SILICONFLOW_OMNI_ENABLED=1 \
#     -e SUPABASE_URL=... \
#     -e SUPABASE_SERVICE_ROLE_KEY=... \
#     -e PUBLIC_BASE_URL=https://your-host.example \
#     piko-python
#
# Then set web-demo/pikoCloudConfig.js → analysisBaseUrl to that PUBLIC_BASE_URL.

FROM python:3.11-slim-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    libsndfile1 \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV HOST=0.0.0.0
ENV PORT=8001
EXPOSE 8001

CMD ["sh", "-c", "uvicorn app:app --host ${HOST} --port ${PORT}"]
