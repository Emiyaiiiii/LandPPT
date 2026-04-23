"""
Main FastAPI application entry point
"""

from fastapi import FastAPI, HTTPException, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, FileResponse, RedirectResponse
import uvicorn
import asyncio
import logging
import os
import sys
from sqlalchemy.orm import Session
from .api.openai_compat import router as openai_router
from .api.landppt_api import router as landppt_router
from .api.database_api import router as database_router
from .api.global_master_template_api import router as template_api_router
from .api.config_api import router as config_router
from .api.image_api import router as image_router

from .web import router as web_router
from .web.admin_routes import router as admin_router
from .web.community_routes import router as community_router
from .web.credits_routes import router as credits_router
from .auth import auth_router, create_auth_middleware, get_auth_service
from .auth.middleware import _extract_api_key, _extract_session_id
from .database.startup_initialization import run_startup_initialization
from .database.database import get_db
from .core.config import app_config

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Disable SQLAlchemy verbose logging completely
logging.getLogger('sqlalchemy').setLevel(logging.WARNING)
logging.getLogger('sqlalchemy.engine').setLevel(logging.WARNING)
logging.getLogger('sqlalchemy.engine.Engine').setLevel(logging.WARNING)
logging.getLogger('sqlalchemy.pool').setLevel(logging.WARNING)
logging.getLogger('sqlalchemy.dialects').setLevel(logging.WARNING)

# Create FastAPI app
app = FastAPI(
    title="PPT AGENT API",
    description="AI-powered PPT generation platform with OpenAI-compatible API",
    version="0.1.0",
    docs_url="/docs" if app_config.enable_api_docs else None,
    redoc_url="/redoc" if app_config.enable_api_docs else None,
    openapi_url="/openapi.json" if app_config.enable_api_docs else None,
)


@app.on_event("startup")
async def startup_event():
    """Initialize database on startup"""
    try:
        await run_startup_initialization()

    except Exception as e:
        logger.error(f"Failed to initialize application: {e}")
        raise


@app.on_event("shutdown")
async def shutdown_event():
    """Clean up database connections on shutdown"""
    try:
        logger.info("Shutting down application...")
        # Close cache service if enabled
        try:
            from .services.cache_service import close_cache_service
            await close_cache_service()
        except Exception:
            pass
        logger.info("Application shutdown complete")
    except Exception as e:
        logger.error(f"Error during shutdown: {e}")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify actual origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Add authentication middleware
auth_middleware = create_auth_middleware()
app.middleware("http")(auth_middleware)

# Include routers
app.include_router(auth_router, prefix="", tags=["Authentication"])
app.include_router(config_router, prefix="", tags=["Configuration Management"])
app.include_router(image_router, prefix="", tags=["Image Service"])

# Web router must come before landppt_router to ensure specific endpoints take precedence
app.include_router(web_router, prefix="", tags=["Web Interface"])
app.include_router(admin_router, tags=["Admin Management"])
app.include_router(community_router, tags=["Community Pages"])
app.include_router(credits_router, tags=["Credits System"])
app.include_router(openai_router, prefix="/v1", tags=["OpenAI Compatible"])
app.include_router(landppt_router, prefix="/api", tags=["LandPPT API"])
app.include_router(template_api_router, tags=["Global Master Templates"])
app.include_router(database_router, tags=["Database Management"])


# Mount static files
static_dir = os.path.join(os.path.dirname(__file__), "web", "static")
app.mount("/static", StaticFiles(directory=static_dir), name="static")

# Redirect /assets/ font requests to fontsource CDN
# AI-generated slide HTML may reference fonts like /assets/inter-latin-400-normal-C38fXH4l.woff2
# (Vite/@fontsource bundled paths). This route parses the naming pattern and redirects to CDN.
import re
_FONTSOURCE_RE = re.compile(
    r'^(?P<family>[a-z0-9-]+?)-(?P<subset>[a-z]+)-(?P<weight>\d+)-(?P<style>[a-z]+)-[A-Za-z0-9_-]+\.woff2$'
)

@app.get("/assets/{filename:path}")
async def serve_font_asset(filename: str):
    """Redirect fontsource-style font requests to jsDelivr CDN"""
    from fastapi.responses import RedirectResponse
    m = _FONTSOURCE_RE.match(filename)
    if m:
        family = m.group('family')
        subset = m.group('subset')
        weight = m.group('weight')
        style = m.group('style')
        cdn_url = f"https://cdn.jsdelivr.net/fontsource/fonts/{family}@latest/{subset}-{weight}-{style}.woff2"
        return RedirectResponse(url=cdn_url, status_code=301)
    raise HTTPException(status_code=404, detail="Asset not found")

# Mount temp directory for image cache
temp_dir = os.path.join(os.getcwd(), "temp")
if os.path.exists(temp_dir):
    app.mount("/temp", StaticFiles(directory=temp_dir), name="temp")
    logger.info(f"Mounted temp directory: {temp_dir}")
else:
    logger.warning(f"Temp directory not found: {temp_dir}")

@app.get("/")
async def root(
    request: Request,
    db: Session = Depends(get_db)
):
    """Root endpoint - check auth and redirect.
    
    Supports two authentication methods:
    1. Session cookie authentication (regular login)
    2. External JWT token authentication (from URL parameter or Authorization header)
    
    Supports user switching when already logged in with ?token=xxx&switch_user=1
    """
    auth_service = get_auth_service()
    
    # Check for external token in URL parameter first
    token = request.query_params.get('token')
    switch_user = request.query_params.get('switch_user')
    
    # If no token in URL, check Authorization header
    if not token:
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header.split(" ")[1]
    
    # If external token is provided, validate it and create session
    if token:
        try:
            new_user = auth_service.get_user_by_token(db, token)
            if new_user:
                # Check if user is already logged in
                current_user = None
                existing_session_id = request.cookies.get("session_id")
                logger.info(f"Token login attempt: new_user_id={new_user.id}, existing_session_id={existing_session_id}")
                if existing_session_id:
                    current_user = auth_service.get_user_by_session(db, existing_session_id)
                    if current_user:
                        logger.info(f"Current user found: current_user_id={current_user.id}, new_user_id={new_user.id}")
                    else:
                        logger.info("No current user found from existing session")
                
                # If same user and not explicitly switching, just redirect to dashboard
                if current_user and current_user.id == new_user.id and not switch_user:
                    logger.info(f"Same user login, redirecting to dashboard: user_id={new_user.id}")
                    return RedirectResponse(url="/dashboard", status_code=302)
                
                # If switching user, invalidate the old session first
                if existing_session_id and current_user and current_user.id != new_user.id:
                    auth_service.logout_user(db, existing_session_id)
                    logger.info(f"Invalidated old session for user switch: old_user_id={current_user.id}, new_user_id={new_user.id}")
                
                # Create new session for the user (switches user if already logged in)
                new_session_id = auth_service.create_session(db, new_user)
                logger.info(f"Created new session: session_id={new_session_id} for user_id={new_user.id}")
                
                # Redirect to dashboard with session cookie
                response = RedirectResponse(url="/dashboard", status_code=302)
                
                # Set cookie max_age based on session expiration
                current_expire_minutes = auth_service._get_current_expire_minutes()
                cookie_max_age = None if current_expire_minutes == 0 else current_expire_minutes * 60
                
                response.set_cookie(
                    key="session_id",
                    value=new_session_id,
                    max_age=cookie_max_age,
                    httponly=True,
                    secure=False,  # Set to True in production with HTTPS
                    samesite="lax"
                )
                
                if current_user and current_user.id != new_user.id:
                    logger.info(f"User switched from {current_user.username} to {new_user.username} via token at root")
                else:
                    logger.info(f"User {new_user.username} logged in via token at root")
                return response
            else:
                # Token invalid, redirect to login with error
                return RedirectResponse(url="/auth/login?error=登录链接已过期或无效", status_code=302)
        except Exception as e:
            logger.error(f"Token authentication error: {e}")
            return RedirectResponse(url="/auth/login?error=自动登录失败，请手动登录", status_code=302)
    
    # Check for existing session cookie
    session_id = request.cookies.get("session_id")
    if session_id:
        user = auth_service.get_user_by_session(db, session_id)
        if user:
            # User is authenticated via session, redirect to dashboard
            return RedirectResponse(url="/dashboard", status_code=302)
    
    # Not authenticated, redirect to login page
    return RedirectResponse(url="/auth/login", status_code=302)

@app.get("/favicon.ico")
async def favicon():
    """Serve favicon"""
    favicon_path = os.path.join(os.path.dirname(__file__), "web", "static", "images", "favicon.svg")
    if os.path.exists(favicon_path):
        return FileResponse(favicon_path, media_type="image/svg+xml")
    else:
        raise HTTPException(status_code=404, detail="Favicon not found")

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "service": "PPT AGENT API"}

if __name__ == "__main__":
    uvicorn.run(
        "src.landppt.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info"
    )
