"""Job class definition for worker tasks."""
from typing import Dict, Any, Optional


class Job:
    """Represents a job to be processed by the worker."""
    
    def __init__(
        self,
        job_id: str,
        messages: list,
        model: str,
        temperature: float = 1.0,
        stream: bool = True,
        deployed_resources: Optional[Dict[str, Any]] = None
    ):
        self.job_id = job_id
        self.messages = messages
        self.model = model
        self.temperature = temperature
        self.stream = stream
        self.deployed_resources = deployed_resources or {}
