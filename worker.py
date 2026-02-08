"""Worker process for handling LLM jobs with function calling support."""
import multiprocessing
import uuid
import os
from typing import Dict, Any, Optional

from logging_config import setup_worker_logging
from job import Job
from job_processor import process_job


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


class WorkerProcess:
    """Manages the worker subprocess."""
    
    def __init__(self, input_queue: multiprocessing.Queue, output_queue: multiprocessing.Queue):
        self.input_queue = input_queue
        self.output_queue = output_queue
        self.process: Optional[multiprocessing.Process] = None
    
    def start(self):
        """Start the worker subprocess."""
        # Use spawn context to avoid fork/spawn issues
        ctx = multiprocessing.get_context('spawn')
        self.process = ctx.Process(target=worker_main, args=(self.input_queue, self.output_queue))
        self.process.start()
    
    def stop(self):
        """Stop the worker subprocess."""
        if self.process and self.process.is_alive():
            self.process.terminate()
            self.process.join(timeout=5)


class QueueManager:
    """Manages the job queue and worker process."""
    
    def __init__(self):
        # Use spawn context for queues too
        ctx = multiprocessing.get_context('spawn')
        self.input_queue = ctx.Queue()
        self.output_queue = ctx.Queue()
        self.worker = WorkerProcess(self.input_queue, self.output_queue)
    
    def start(self):
        """Start the queue manager and worker."""
        self.worker.start()
    
    def stop(self):
        """Stop the queue manager and worker."""
        self.input_queue.put(None)  # Signal worker to shutdown
        self.worker.stop()
    
    def submit_job(
        self,
        messages: list,
        model: str,
        temperature: float = 1.0,
        deployed_resources: Optional[Dict[str, Any]] = None
    ) -> str:
        """Submit a new job to the queue."""
        job_id = str(uuid.uuid4())
        job_data = {
            "job_id": job_id,
            "messages": messages,
            "model": model,
            "temperature": temperature,
            "stream": True,
            "deployed_resources": deployed_resources or {}
        }
        self.input_queue.put(job_data)
        return job_id
    
    def get_output(self, timeout: float = 0.1):
        """Non-blocking read from output queue."""
        try:
            return self.output_queue.get(timeout=timeout)
        except:
            return None


# Global queue manager instance
queue_manager = QueueManager()
