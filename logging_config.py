"""Logging configuration for the worker process."""
import logging
import sys


def setup_worker_logging() -> logging.Logger:
    """Setup worker logging with file and stream handlers."""
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
