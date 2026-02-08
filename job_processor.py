"""Job processing logic for the worker."""
import json
import multiprocessing
import logging
from typing import Dict, Any

from job import Job
from tools import build_tools, execute_tool_call, build_system_prompt


def process_job(
    job: Job,
    output_queue: multiprocessing.Queue,
    client,
    logger: logging.Logger
):
    """Execute LLM call with function calling support and return results to output queue."""
    # Import error classes here for the spawned process
    from openai import APIError, APIStatusError
    
    logger.info(f"Processing job {job.job_id}: model={job.model}")
    logger.info(f"Deployed resources: {list(job.deployed_resources.keys()) if job.deployed_resources else 'none'}")
    
    try:
        # Prepare messages with system prompt injection
        messages = [msg.copy() for msg in job.messages]
        
        # Build system prompt from deployed resources
        tool_system_prompt = build_system_prompt(job.deployed_resources)
        
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
        
        # Build tools from deployed resources
        tools = build_tools(job.deployed_resources)
        logger.info(f"Available tools: {[t['function']['name'] for t in tools] if tools else 'none'}")
        
        # Make the API call (non-streaming for function calling)
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
        
        # Loop to handle multiple rounds of tool calls
        max_iterations = 1024
        iteration = 0
        
        while message.tool_calls and iteration < max_iterations:
            iteration += 1
            logger.info(f"Tool calls requested (iteration {iteration}): {len(message.tool_calls)}")
            
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
                }, job.deployed_resources, logger)
                
                logger.info(f"Tool execution result: {result[:200]}..." if len(result) > 200 else f"Tool execution result: {result}")
                
                # Add tool response
                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": result
                })
            
            # Get the next response after tool execution
            logger.info(f"Getting response after tool execution (iteration {iteration})...")
            response = client.chat.completions.create(
                model=job.model,
                messages=messages,
                temperature=job.temperature,
                tools=tools if tools else None,
                tool_choice="auto" if tools else None,
                stream=False
            )
            
            message = response.choices[0].message
        
        if iteration >= max_iterations:
            logger.warning(f"Reached maximum tool call iterations ({max_iterations})")
        
        # Send the complete response
        content = message.content or ""
        logger.info(f"Job {job.job_id} completed: {len(content)} chars")
        
        # Stream the content character by character to maintain streaming interface
        for char in content:
            output_queue.put({
                "job_id": job.job_id,
                "type": "chunk",
                "data": char
            })
        
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
