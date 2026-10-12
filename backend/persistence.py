"""Neon persistence and Cognito bearer-token authentication."""
import os
from functools import lru_cache
from typing import Optional

import jwt
import psycopg2
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from psycopg2.extras import Json, RealDictCursor

bearer = HTTPBearer(auto_error=False)


def db():
    url = os.getenv("POSTGRES_DB_URL")
    if not url:
        raise HTTPException(503, "Database is not configured")
    conn = psycopg2.connect(url, cursor_factory=RealDictCursor)
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
        if claims.get("token_use") != "id" or claims.get("aud") != client_id:
            raise ValueError("Invalid Cognito token")
    except Exception:
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
