"""File-related tools for LLM function calling."""
import json
import os
from typing import Dict, Any, List


def build_file_tools() -> List[Dict[str, Any]]:
    """Build file-related tools from resource configuration."""
    tools = []

    tools.append({
        "type": "function",
        "function": {
            "name": "list_files",
            "description": f"List files and directories in a folder. Use the resource_id parameter to specify which folder to access.",
            "parameters": {
                "type": "object",
                "properties": {
                    "resource_id": {
                        "type": "string",
                        "description": f"The resource ID of the folder to list."
                    },
                    "subpath": {
                        "type": "string",
                        "description": "Optional subdirectory path relative to the root folder. If not provided, lists the root folder contents."
                    }
                },
                "required": ["resource_id"],
                "additionalProperties": False
            }
        }
    })
    
    return tools


def execute_file_tool(
    tool_call: Dict[str, Any],
    deployed_resources: Dict[str, Any],
    logger
) -> str:
    """Execute a file-related tool call."""
    function_name = tool_call.get('function', {}).get('name')
    arguments_str = tool_call.get('function', {}).get('arguments', '{}')
    
    try:
        arguments = json.loads(arguments_str) if arguments_str else {}
    except json.JSONDecodeError:
        logger.error(f"Failed to parse tool arguments: {arguments_str}")
        return json.dumps({"error": "Invalid arguments"})
    
    logger.info(f"Executing tool: {function_name} with args: {arguments}")
    
    if function_name == 'list_files':
        return _list_files(arguments, deployed_resources, logger)
    
    return json.dumps({"error": f"Unknown file function: {function_name}"})


def _list_files(
    arguments: Dict[str, Any],
    deployed_resources: Dict[str, Any],
    logger
) -> str:
    """List files and directories in the deployed folder."""
    # Get the resource_id from arguments
    resource_id = arguments.get('resource_id')
    if not resource_id:
        return json.dumps({"error": "Missing required parameter: resource_id"})
    
    # Get the folder path from deployed resources
    folder_resource = deployed_resources.get(resource_id, {})
    base_path = folder_resource.get('path')
    
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
