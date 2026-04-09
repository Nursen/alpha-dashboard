from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError
from config import SUPABASE_JWT_SECRET

security = HTTPBearer(auto_error=False)


async def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
) -> str:
    """
    Verify Supabase JWT and return user_id.

    Dev bypass: if SUPABASE_JWT_SECRET is not set, accepts X-Dev-User header.
    """
    # Dev bypass when no secret configured
    if not SUPABASE_JWT_SECRET:
        dev_user = request.headers.get("X-Dev-User")
        if dev_user:
            return dev_user
        return "dev-user"

    if credentials is None:
        raise HTTPException(status_code=401, detail="Missing authorization token")

    try:
        payload = jwt.decode(
            credentials.credentials,
            SUPABASE_JWT_SECRET,
            algorithms=["HS256"],
            options={"verify_aud": False},
        )
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token: no sub claim")
        return user_id
    except JWTError as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {e}")
