"""Reads secrets from AWS Secrets Manager, cached for the life of the Lambda container."""

import json
from functools import lru_cache

import boto3


@lru_cache(maxsize=None)
def get_secret(secret_arn: str) -> str:
    """Returns the secret string. A JSON secret with a single key returns that key's value."""
    value = boto3.client("secretsmanager").get_secret_value(SecretId=secret_arn)["SecretString"]
    try:
        parsed = json.loads(value)
    except ValueError:
        return value.strip()
    if isinstance(parsed, dict) and len(parsed) == 1:
        return str(next(iter(parsed.values()))).strip()
    raise ValueError(f"Secret {secret_arn} must be a plain string or a JSON object with exactly one key")
