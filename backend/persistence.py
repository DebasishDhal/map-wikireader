"""Neon persistence and Cognito bearer-token authentication."""
import os
from functools import lru_cache
from typing import Optional

import jwt
import psycopg2
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from psycopg2.extras import Json, RealDictCursor
from backend.logger.logger_setup import normal_logger as logger

bearer = HTTPBearer(auto_error=False)


def db():
    url = os.getenv("POSTGRES_DB_URL")
    if not url:
        raise HTTPException(503, "Database is not configured")
    try:
        conn = psycopg2.connect(url, cursor_factory=RealDictCursor)
    except Exception:
        logger.exception("Postgres connection failed")
        raise HTTPException(503, "Could not connect to the database") from None
    try:
        yield conn
    finally:
        conn.close()


@lru_cache(maxsize=2)
def jwks_client(issuer):
    return jwt.PyJWKClient(f"{issuer}/.well-known/jwks.json")


def current_user(credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer), conn=Depends(db)):
    issuer = os.getenv("COGNITO_ISSUER")
    client_id = os.getenv("COGNITO_CLIENT_ID")
    if not credentials or not issuer or not client_id:
        raise HTTPException(401, "Sign in is required")
    try:
        key = jwks_client(issuer).get_signing_key_from_jwt(credentials.credentials).key
        claims = jwt.decode(credentials.credentials, key, algorithms=["RS256"], issuer=issuer,
                            options={"verify_aud": False})
        if claims.get("token_use") != "id":
            raise ValueError("Cognito returned a token that is not an ID token")
        if claims.get("aud") != client_id:
            raise ValueError("ID token audience does not match COGNITO_CLIENT_ID")
    except Exception as error:
        # Log the validation reason for diagnosis, but never log the bearer token.
        logger.warning("Cognito ID-token validation failed (%s): %s", type(error).__name__, error, exc_info=True)
        raise HTTPException(401, "Your session is invalid or expired")
    with conn.cursor() as cur:
        cur.execute('''INSERT INTO users (cognitor_sub,email,display_name) VALUES (%s,%s,%s)
                       ON CONFLICT (cognitor_sub) DO UPDATE SET email=EXCLUDED.email,
                       display_name=EXCLUDED.display_name RETURNING id,cognitor_sub,email,display_name''',
                    (claims["sub"], claims.get("email"), claims.get("name") or claims.get("cognito:username")))
        user = cur.fetchone()
        cur.execute("SELECT id FROM lists WHERE user_id=%s AND is_default=true LIMIT 1", (user["id"],))
        if not cur.fetchone():
            cur.execute("INSERT INTO lists (user_id,name,description,visibility,is_default) VALUES (%s,'Favorites','Saved places','private',true)", (user["id"],))
    conn.commit()
    return user


def record_activity(conn, user_id, kind, payload=None):
    with conn.cursor() as cur:
        cur.execute("INSERT INTO user_activities (user_id,activity_type,payload) VALUES (%s,%s,%s)",
                    (user_id, kind, Json(payload or {})))
