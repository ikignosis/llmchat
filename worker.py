import multiprocessing
import uuid
import json
from typing import Dict, Any, Optional, List
import os
import sys
import logging
from datetime import datetime

# Setup worker logging
def setup_worker_logging():
    log_file = "worker.log"
    
    # Get logger first
    logger = logging.getLogger("worker")
    logger.setLevel(logging.INFO)
    
    # Clear any existing handlers (inherited from parent process)
    logger.handlers.clear()
    
    # Remove propagation to avoid duplicate logs from root logger
    logger.propagate = False
    
    # Create file handler with immediate flush
    file_handler = logging.FileHandler(log_file, mode='a')
    file_handler.setFormatter(logging.Formatter('%(asctime)s [%(levelname)s] %(message)s'))
    
    # Create stream handler
    stream_handler = logging.StreamHandler(sys.stdout)
    stream_handler.setFormatter(logging.Formatter('%(asctime)s [%(levelname)s] %(message)s'))
    
    # Add handlers
    logger.addHandler(file_handler)
    logger.addHandler(stream_handler)
    
    return logger


class Job:
    def __init__(self, job_id: str, messages: list, model: str, temperature: float = 1.0, stream: bool = True, deployed_tools: Optional[Dict[str, Any]] = None):
        self.job_id = job_id
        self.messages = messages
        self.model = model
        self.temperature = temperature
        self.stream = stream
        self.deployed_tools = deployed_tools or {}


def worker_main(input_queue: multiprocessing.Queue, output_queue: multiprocessing.Queue):
    """Main worker loop - runs in separate process"""
    # Setup logging first
    logger = setup_worker_logging()
    logger.info("=" * 50)
    logger.info("Worker process started")
    logger.info(f"PID: {os.getpid()}")
    logger.info("=" * 50)
    
    # Import here to avoid pickle issues
    from config import settings
    from openai import OpenAI
    from openai import APIError, APIStatusError
    
    logger.info(f"OpenAI Base URL: {settings.openai_base_url}")
    logger.info(f"Default Model: {settings.default_model}")
    
    # Initialize OpenAI client
    client = OpenAI(
        api_key=settings.openai_api_key or "not-needed",
        base_url=settings.openai_base_url,
        timeout=300.0
    )
    
    while True:
        try:
            # Get job from input queue (blocking)
            logger.debug("Waiting for job from input queue...")
            job_data = input_queue.get()
            
            if job_data is None:  # Shutdown signal
                logger.info("Received shutdown signal, exiting...")
                break
            
            logger.info(f"Received job: {job_data.get('job_id', 'unknown')}")
            logger.debug(f"Job details: model={job_data.get('model')}, messages={len(job_data.get('messages', []))}")
            
            job = Job(**job_data)
            process_job(job, output_queue, client, logger)
            
        except Exception as e:
            logger.exception(f"Worker error: {e}")
    
    logger.info("Worker process shutting down")


def build_system_prompt(deployed_tools: Dict[str, Any]) -> str:
    """Build a system prompt based on deployed tools"""
    if not deployed_tools:
        return ""
    
    prompts = []
    for tool_id, tool_config in deployed_tools.items():
        tool_name = tool_config.get('name', tool_id)
        
        if tool_id == 'folder':
            path = tool_config.get('path')
            if path:
                prompts.append(f"You have access to the user folder at path: {path}")
        # Add more tool-specific prompts here as needed
    
    return "\n\n".join(prompts)


def build_tools(deployed_tools: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Build OpenAI function tools based on deployed tools"""
    tools = []
    
    logger = logging.getLogger("worker")
    logger.info(f"Building tools from: {deployed_tools}")
    
    for tool_id, tool_config in deployed_tools.items():
        logger.info(f"Processing tool: {tool_id}, config: {tool_config}")
        if tool_id == 'folder':
            path = tool_config.get('path') if isinstance(tool_config, dict) else None
            logger.info(f"Folder path: {path}")
            if path:
                tools.append({
                    "type": "function",
                    "function": {
                        "name": "list_files",
                        "description": f"List files and directories in the user's folder at {path}. Use this when the user asks about files, contents, or what's in their folder.",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "subpath": {
                                    "type": "string",
                                    "description": "Optional subdirectory path relative to the root folder. If not provided, lists the root folder contents."
                                }
                            },
                            "required": [],
                            "additionalProperties": False
                        }
                    }
                })
        # Add more tool functions here as needed
    
    return tools


def execute_tool_call(tool_call: Dict[str, Any], deployed_tools: Dict[str, Any], logger) -> str:
    """Execute a tool call and return the result"""
    function_name = tool_call.get('function', {}).get('name')
    arguments_str = tool_call.get('function', {}).get('arguments', '{}')
    
    try:
        arguments = json.loads(arguments_str) if arguments_str else {}
    except json.JSONDecodeError:
        logger.error(f"Failed to parse tool arguments: {arguments_str}")
        return json.dumps({"error": "Invalid arguments"})
    
    logger.info(f"Executing tool: {function_name} with args: {arguments}")
    
    if function_name == 'list_files':
        # Get the folder path from deployed tools
        folder_tool = deployed_tools.get('folder', {})
        base_path = folder_tool.get('path')
        
        if not base_path:
            return json.dumps({"error": "No folder path configured"})
        
        # Get optional subpath
        subpath = arguments.get('subpath', '')
        target_path = os.path.join(base_path, subpath) if subpath else base_path
        
        # Security: ensure the target path is within the base path
        target_path = os.path.normpath(os.path.abspath(target_path))
        base_path_normalized = os.path.normpath(os.path.abspath(base_path))
        
        # Use case-insensitive comparison on Windows
        if os.name == 'nt':  # Windows
            target_path_lower = target_path.lower()
            base_path_lower = base_path_normalized.lower()
            is_within = target_path_lower.startswith(base_path_lower)
        else:
            is_within = target_path.startswith(base_path_normalized)
        
        logger.info(f"Checking PATH target={target_path}, base={base_path_normalized}, within={is_within}")
        
        if not is_within:
            return json.dumps({"error": "Access denied: path outside of allowed folder"})
        
        try:
            if not os.path.exists(target_path):
                return json.dumps({"error": f"Path does not exist: {subpath or '.'}"})
            
            if not os.path.isdir(target_path):
                return json.dumps({"error": f"Path is not a directory: {subpath or '.'}"})
            
            entries = []
            for entry in os.listdir(target_path):
                entry_path = os.path.join(target_path, entry)
                entry_info = {
                    "name": entry,
                    "type": "directory" if os.path.isdir(entry_path) else "file",
                    "size": os.path.getsize(entry_path) if os.path.isfile(entry_path) else None
                }
                entries.append(entry_info)
            
            # Sort: directories first, then files
            entries.sort(key=lambda x: (0 if x['type'] == 'directory' else 1, x['name'].lower()))
            
            result = {
                "path": subpath or ".",
                "full_path": target_path,
                "entries": entries
            }
            logger.info(f"list_files returned {len(entries)} entries")
            return json.dumps(result, indent=2)
            
        except Exception as e:
            logger.exception(f"Error listing files: {e}")
            return json.dumps({"error": str(e)})
    
    return json.dumps({"error": f"Unknown function: {function_name}"})


def process_job(job: Job, output_queue: multiprocessing.Queue, client, logger):
    """Execute LLM call with function calling support and stream results to output queue"""
    # Import error classes here for the spawned process
    from openai import APIError, APIStatusError
    
    logger.info(f"Processing job {job.job_id}: model={job.model}")
    logger.info(f"Deployed tools: {list(job.deployed_tools.keys()) if job.deployed_tools else 'none'}")
    
    try:
        # Prepare messages with system prompt injection
        messages = [msg.copy() for msg in job.messages]
        
        # Build system prompt from deployed tools
        tool_system_prompt = build_system_prompt(job.deployed_tools)
        
        if tool_system_prompt:
            # Check if there's already a system message
            if messages and messages[0].get('role') == 'system':
                # Append to existing system message
                original_content = messages[0].get('content', '')
                messages[0]['content'] = f"{original_content}\n\n{tool_system_prompt}".strip()
            else:
                # Insert new system message at the beginning
                messages.insert(0, {
                    'role': 'system',
                    'content': tool_system_prompt
                })
            
            logger.info(f"Injected system prompt: {tool_system_prompt[:100]}...")
        
        # Build tools from deployed tools
        tools = build_tools(job.deployed_tools)
        logger.info(f"Available tools: {[t['function']['name'] for t in tools] if tools else 'none'}")
        
        # Make the initial API call (non-streaming for function calling)
        logger.debug(f"Creating chat completion with tools...")
        logger.debug(f"Messages: {json.dumps(messages, indent=2)}")
        
        response = client.chat.completions.create(
            model=job.model,
            messages=messages,
            temperature=job.temperature,
            tools=tools if tools else None,
            tool_choice="auto" if tools else None,
            stream=False
        )
        
        message = response.choices[0].message
        
        # Check if there's a tool call
        if message.tool_calls:
            logger.info(f"Tool calls requested: {len(message.tool_calls)}")
            
            # Add the assistant's message with tool calls
            # Include reasoning_content for models that require it (e.g., Kimi)
            assistant_message = {
                "role": "assistant",
                "content": message.content or "",
                "tool_calls": [
                    {
                        "id": tc.id,
                        "type": tc.type,
                        "function": {
                            "name": tc.function.name,
                            "arguments": tc.function.arguments
                        }
                    }
                    for tc in message.tool_calls
                ]
            }
            
            # Add reasoning_content if present (required by some models like Kimi)
            if hasattr(message, 'reasoning_content') and message.reasoning_content:
                assistant_message["reasoning_content"] = message.reasoning_content
            
            messages.append(assistant_message)
            
            # Execute tool calls
            for tool_call in message.tool_calls:
                result = execute_tool_call({
                    "id": tool_call.id,
                    "type": tool_call.type,
                    "function": {
                        "name": tool_call.function.name,
                        "arguments": tool_call.function.arguments
                    }
                }, job.deployed_tools, logger)
                
                logger.info(f"Tool execution result: {result[:200]}..." if len(result) > 200 else f"Tool execution result: {result}")
                
                # Add tool response
                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": result
                })
            
            # Stream the final response after tool execution
            logger.info("Streaming final response after tool execution...")
            stream = client.chat.completions.create(
                model=job.model,
                messages=messages,
                temperature=job.temperature,
                stream=True
            )
            
        else:
            # No tool calls, stream the initial response
            logger.info("No tool calls, streaming response...")
            # We need to stream the content from the non-streaming response
            # or make a new streaming call. Let's make a new streaming call for consistency.
            stream = client.chat.completions.create(
                model=job.model,
                messages=messages,
                temperature=job.temperature,
                stream=True
            )
        
        # Stream the response
        chunk_count = 0
        total_chars = 0
        
        for chunk in stream:
            delta = chunk.choices[0].delta.content
            
            if delta:
                chunk_count += 1
                total_chars += len(delta)
                output_queue.put({
                    "job_id": job.job_id,
                    "type": "chunk",
                    "data": delta
                })
        
        logger.info(f"Job {job.job_id} completed: {chunk_count} chunks, {total_chars} chars")
        output_queue.put({
            "job_id": job.job_id,
            "type": "done",
            "data": ""
        })
                        
    except APIStatusError as e:
        # This gives us detailed error information including the response body
        error_details = {
            "status_code": e.status_code,
            "message": str(e),
            "response": e.response.text if e.response else "No response body",
        }
        # Add headers if available from the response
        if e.response and hasattr(e.response, 'headers'):
            error_details["headers"] = dict(e.response.headers)
        error_msg = f"API error {e.status_code}: {e.response.text if e.response else str(e)}"
        logger.error(f"Job {job.job_id} failed: {error_msg}")
        logger.error(f"Error details: {json.dumps(error_details, indent=2)}")
        output_queue.put({
            "job_id": job.job_id,
            "type": "error",
            "data": error_msg
        })
    except APIError as e:
        error_msg = f"API error: {str(e)}"
        logger.error(f"Job {job.job_id} failed: {error_msg}")
        output_queue.put({
            "job_id": job.job_id,
            "type": "error",
            "data": error_msg
        })
    except Exception as e:
        error_msg = str(e)
        logger.exception(f"Job {job.job_id} failed: {error_msg}")
        output_queue.put({
            "job_id": job.job_id,
            "type": "error",
            "data": error_msg
        })


class WorkerProcess:
    def __init__(self, input_queue: multiprocessing.Queue, output_queue: multiprocessing.Queue):
        self.input_queue = input_queue
        self.output_queue = output_queue
        self.process: Optional[multiprocessing.Process] = None
    
    def start(self):
        # Use spawn context to avoid fork/spawn issues
        ctx = multiprocessing.get_context('spawn')
        self.process = ctx.Process(target=worker_main, args=(self.input_queue, self.output_queue))
        self.process.start()
    
    def stop(self):
        if self.process and self.process.is_alive():
            self.process.terminate()
            self.process.join(timeout=5)


class QueueManager:
    def __init__(self):
        # Use spawn context for queues too
        ctx = multiprocessing.get_context('spawn')
        self.input_queue = ctx.Queue()
        self.output_queue = ctx.Queue()
        self.worker = WorkerProcess(self.input_queue, self.output_queue)
    
    def start(self):
        self.worker.start()
    
    def stop(self):
        self.input_queue.put(None)  # Signal worker to shutdown
        self.worker.stop()
    
    def submit_job(self, messages: list, model: str, temperature: float = 1.0, deployed_tools: Optional[Dict[str, Any]] = None) -> str:
        job_id = str(uuid.uuid4())
        job_data = {
            "job_id": job_id,
            "messages": messages,
            "model": model,
            "temperature": temperature,
            "stream": True,
            "deployed_tools": deployed_tools or {}
        }
        self.input_queue.put(job_data)
        return job_id
    
    def get_output(self, timeout: float = 0.1):
        """Non-blocking read from output queue"""
        try:
            return self.output_queue.get(timeout=timeout)
        except:
            return None


# Global queue manager instance
queue_manager = QueueManager()
