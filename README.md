# LLM Chat Web App

A ChatGPT-like web application for interacting with LLM models via OpenAI-compatible APIs. Features a dedicated worker process with input/output queues for decoupled LLM processing.

## Architecture

```
┌─────────────┐      POST /chat      ┌─────────────┐
│   Client    │ ───────────────────> │  FastAPI    │
│  (Browser)  │                      │   Server    │
└─────────────┘                      └──────┬──────┘
       ^                                    │
       │                              ┌─────┴─────┐
       │                              │  Input    │
       │                              │   Queue   │
       │                              └─────┬─────┘
       │                                    │
       │                              ┌─────┴─────┐
       │                              │  Worker   │
       │                              │  Process  │──> LLM API
       │                              │  (OpenAI) │
       │                              └─────┬─────┘
       │                                    │
       │                              ┌─────┴─────┐
       │                              │  Output   │
       │                              │   Queue   │
       │                              └─────┬─────┘
       │                                    │
       └────────────────────────────────────┘
                    SSE /stream
```

## Features

- **Dedicated Worker Process**: LLM calls run in a separate process with input/output queues
- **Streaming Support**: Real-time token streaming via Server-Sent Events (SSE)
- **OpenAI-Compatible**: Works with any OpenAI-compatible endpoint (OpenAI, Ollama, llama.cpp, etc.)
- **ChatGPT-like UI**: Clean, modern interface with markdown support and code highlighting
- **No Node.js Required**: Pure Python backend + vanilla JavaScript frontend

## Quick Start

### 1. Install Dependencies

```bash
pip install -r requirements.txt
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your API keys and settings
```

### 3. Run the Application

```bash
python main.py
```

The app will be available at `http://localhost:8000`

## Configuration

### Using OpenAI

```env
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://api.openai.com/v1
DEFAULT_MODEL=gpt-4
```

### Using Ollama (Local Models)

```bash
# Start Ollama server
ollama serve

# Pull a model
ollama pull llama2
```

```env
OPENAI_API_KEY=not-needed
OPENAI_BASE_URL=http://localhost:11434/v1
DEFAULT_MODEL=llama2
```

### Using llama.cpp Server

```bash
# Start llama.cpp server
./server -m model.gguf --port 8080
```

```env
OPENAI_API_KEY=not-needed
OPENAI_BASE_URL=http://localhost:8080/v1
DEFAULT_MODEL=model
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Chat UI |
| `/chat` | POST | Submit a chat message, returns job_id |
| `/stream/{job_id}` | GET | SSE endpoint for streaming response |
| `/models` | GET | List available models |

## Project Structure

```
.
├── main.py              # FastAPI server with queue management
├── worker.py            # Worker process for LLM calls
├── config.py            # Configuration settings
├── requirements.txt     # Python dependencies
├── .env.example         # Example environment variables
├── static/
│   ├── index.html       # Chat UI
│   └── app.js           # Frontend application
└── README.md            # This file
```

## How It Works

1. **Client** sends a POST request to `/chat` with messages
2. **Server** puts the job in the **Input Queue** and returns a `job_id`
3. **Worker Process** picks up the job and starts streaming from the LLM
4. **Worker** puts response chunks into the **Output Queue**
5. **Client** connects to SSE endpoint `/stream/{job_id}`
6. **Server** reads from Output Queue and streams events to client

This architecture provides:
- **Non-blocking**: FastAPI stays responsive during LLM calls
- **Scalable**: Can add more workers if needed
- **Resilient**: Worker crashes don't kill the server
- **Clean separation**: LLM logic isolated from HTTP layer

## License

MIT
