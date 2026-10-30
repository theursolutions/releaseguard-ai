# Build context is the repository root (same as the other services):
#   docker build -f services/performance-service/Dockerfile .
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /srv

COPY services/performance-service/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY services/performance-service/app ./app

RUN useradd --create-home --uid 10001 service
USER service

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health')"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--timeout-keep-alive", "650"]
