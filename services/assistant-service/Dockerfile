# Build context is the repository root, so the shared AI gateway package can be copied in:
#   docker build -f services/assistant-service/Dockerfile .
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /srv

COPY services/assistant-service/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY services/shared/releaseguard_ai ./releaseguard_ai
COPY services/assistant-service/app ./app

RUN useradd --create-home --uid 10001 service
USER service

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health')"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--timeout-keep-alive", "650"]
