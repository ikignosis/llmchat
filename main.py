import asyncio
import json
import logging
import os
import sys
import uuid
from contextlib import asynccontextmanager
from typing import AsyncGenerator, Dict, Set, List, Optional
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from worker import queue_manager

# Setup server logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.FileHandler("server.log"),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger("server")


# Track active job subscriptions
active_jobs: Dict[str, asyncio.Queue] = {}

# Chat storage
CHATS_FILE = os.path.join(os.path.dirname(__file__), "chats.json")


class ChatSession(BaseModel):
    id: str
    title: str
    messages: List[dict]
    createdAt: str
    deployed_resources: Optional[Dict[str, dict]] = None


class ChatListResponse(BaseModel):
    chats: List[ChatSession]


class ChatCreateRequest(BaseModel):
    id: str
    title: str
    createdAt: str


class ChatUpdateRequest(BaseModel):
    messages: Optional[List[dict]] = None
    title: Optional[str] = None
    deployed_resources: Optional[Dict[str, dict]] = None


def load_chats() -> List[dict]:
    """Load chats from the JSON file"""
    if not os.path.exists(CHATS_FILE):
        return []
    try:
        with open(CHATS_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError) as e:
        logger.error(f"Failed to load chats: {e}")
        return []


def save_chats(chats: List[dict]):
    """Save chats to the JSON file"""
    try:
        with open(CHATS_FILE, 'w', encoding='utf-8') as f:
            json.dump(chats, f, indent=2, ensure_ascii=False)
    except IOError as e:
        logger.error(f"Failed to save chats: {e}")


class ChatRequest(BaseModel):
    messages: list
    model: str = "kimi-k2.5"
    temperature: float = 1.0
    deployed_resources: Optional[Dict[str, dict]] = None


class ChatResponse(BaseModel):
    job_id: str
    status: str = "submitted"


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("=" * 50)
    logger.info("Server starting up")
    logger.info("=" * 50)
    queue_manager.start()
    logger.info("Worker process started")
    
    # Start output queue processor
    asyncio.create_task(process_output_queue())
    logger.info("Output queue processor started")
    
    yield
    
    # Shutdown
    logger.info("Server shutting down")
    queue_manager.stop()
    logger.info("Worker process stopped")


app = FastAPI(lifespan=lifespan)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Static files
app.mount("/static", StaticFiles(directory="static"), name="static")


async def process_output_queue():
    """Background task to read from output queue and distribute to job queues"""
    logger.info("Output queue processor running")
    while True:
        try:
            output = queue_manager.get_output(timeout=0.1)
            if output:
                job_id = output["job_id"]
                msg_type = output["type"]
                logger.debug(f"Received output for job {job_id}: type={msg_type}")
                
                if job_id in active_jobs:
                    await active_jobs[job_id].put(output)
                    
                    # Clean up completed jobs
                    if msg_type in ("done", "error"):
                        logger.info(f"Job {job_id} completed with status: {msg_type}")
                        # Give a moment for the SSE to read before cleanup
                        await asyncio.sleep(1)
                        if job_id in active_jobs:
                            del active_jobs[job_id]
                            
            await asyncio.sleep(0.01)  # Small delay to prevent busy-waiting
        except Exception as e:
            logger.exception(f"Output processor error: {e}")
            await asyncio.sleep(0.1)


@app.post("/chat", response_model=ChatResponse)
async def submit_chat(request: ChatRequest):
    """Submit a chat message to the worker queue"""
    logger.info(f"Received chat request: model={request.model}, messages={len(request.messages)}")
    
    job_id = queue_manager.submit_job(
        messages=request.messages,
        model=request.model,
        temperature=request.temperature,
        deployed_resources=request.deployed_resources
    )
    
    # Create queue for this job's output
    active_jobs[job_id] = asyncio.Queue()
    logger.info(f"Job submitted: {job_id}")
    
    return ChatResponse(job_id=job_id, status="submitted")


@app.get("/stream/{job_id}")
async def stream_response(job_id: str):
    """SSE endpoint to stream LLM response"""
    logger.info(f"Stream request for job: {job_id}")
    
    if job_id not in active_jobs:
        logger.warning(f"Job not found: {job_id}")
        raise HTTPException(status_code=404, detail="Job not found")
    
    job_queue = active_jobs[job_id]
    
    async def event_generator() -> AsyncGenerator[str, None]:
        while True:
            try:
                # Wait for output with timeout
                output = await asyncio.wait_for(job_queue.get(), timeout=300.0)
                
                event_type = output["type"]
                data = output["data"]
                
                if event_type == "chunk":
                    yield f"event: chunk\ndata: {json.dumps({'content': data})}\n\n"
                
                elif event_type == "done":
                    yield f"event: done\ndata: {json.dumps({'content': ''})}\n\n"
                    break
                
                elif event_type == "error":
                    yield f"event: error\ndata: {json.dumps({'error': data})}\n\n"
                    break
                    
            except asyncio.TimeoutError:
                yield f"event: error\ndata: {json.dumps({'error': 'Stream timeout'})}\n\n"
                break
    
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


@app.get("/api/chats", response_model=ChatListResponse)
async def get_chats():
    """Get all chat sessions"""
    chats = load_chats()
    return ChatListResponse(chats=chats)


@app.post("/api/chats")
async def create_chat(request: ChatCreateRequest):
    """Create a new chat session"""
    chats = load_chats()
    # Generate UUID if not provided
    chat_id = request.id if request.id else str(uuid.uuid4())
    chat = {
        "id": chat_id,
        "title": request.title,
        "messages": [],
        "createdAt": request.createdAt,
        "deployed_resources": {}
    }
    chats.insert(0, chat)
    save_chats(chats)
    logger.info(f"Created new chat: {chat_id}")
    return {"status": "created", "chat": chat}


@app.get("/api/chats/{chat_id}")
async def get_chat(chat_id: str):
    """Get a specific chat session"""
    chats = load_chats()
    for chat in chats:
        if chat["id"] == chat_id:
            return chat
    raise HTTPException(status_code=404, detail="Chat not found")


@app.put("/api/chats/{chat_id}")
async def update_chat(chat_id: str, request: ChatUpdateRequest):
    """Update a chat session (messages, title, and/or deployed_resources)"""
    chats = load_chats()
    for chat in chats:
        if chat["id"] == chat_id:
            if request.messages is not None:
                chat["messages"] = request.messages
            if request.title is not None:
                chat["title"] = request.title
            if request.deployed_resources is not None:
                chat["deployed_resources"] = request.deployed_resources
            save_chats(chats)
            logger.info(f"Updated chat: {chat_id}")
            return {"status": "updated", "chat": chat}
    raise HTTPException(status_code=404, detail="Chat not found")


@app.delete("/api/chats/{chat_id}")
async def delete_chat(chat_id: str):
    """Delete a chat session"""
    chats = load_chats()
    chats = [c for c in chats if c["id"] != chat_id]
    save_chats(chats)
    logger.info(f"Deleted chat: {chat_id}")
    return {"status": "deleted"}


@app.get("/")
async def root():
    from fastapi.responses import FileResponse
    return FileResponse("static/index.html")


if __name__ == "__main__":
    import uvicorn
    from config import settings
    
    uvicorn.run(
        "main:app",
        host=settings.host,
        port=settings.port,
        reload=True
    )
