"""Tools module for LLM function calling."""
import json
import logging
from typing import Dict, Any, List

from .file_tools import build_file_tools, execute_file_tool

logger = logging.getLogger("worker")


def build_tools(deployed_resources: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Build OpenAI function tools based on deployed resources."""
    tools = []
    loaded_types = []
    
    logger.info(f"Building tools from: {deployed_resources}")
    
    for resource_id, resource_config in deployed_resources.items():
        logger.info(f"Processing resource: {resource_id}, config: {resource_config}")
        resource_type = resource_config.get('type')
        if resource_type in loaded_types:
            continue
        loaded_types.append(resource_type)
        
        if resource_type == 'folder':
            folder_tools = build_file_tools()
            tools.extend(folder_tools)
        # Add more resource types here as needed
    
    return tools


def execute_tool_call(
    tool_call: Dict[str, Any],
    deployed_resources: Dict[str, Any],
    logger
) -> str:
    """Execute a tool call and return the result."""
    function_name = tool_call.get('function', {}).get('name')
    
    # Route to appropriate tool handler
    if function_name == 'list_files':
        return execute_file_tool(tool_call, deployed_resources, logger)
    
    return json.dumps({"error": f"Unknown function: {function_name}"})


def build_system_prompt(deployed_resources: Dict[str, Any]) -> str:
    """Build a system prompt based on deployed resources."""
    if not deployed_resources:
        return ""
    
    prompts = []
    for resource_id, resource_config in deployed_resources.items():
        resource_name = resource_config.get('name', resource_id)
        resource_type = resource_config.get('type') if isinstance(resource_config, dict) else None
        
        if resource_type == 'folder':
            path = resource_config.get('path')
            if path:
                prompts.append(f"You have access to folder '{resource_name}' (resource_id: {resource_id}) at path: {path}")
        # Add more tool-specific prompts here as needed
    
    return "\n\n".join(prompts)
