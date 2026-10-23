import os
import logging
import time
from logging.handlers import RotatingFileHandler
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
from backend.app_config.logger_config import MAX_VERBOSITY

class RelativePathFormatter(logging.Formatter):
    # Use the process's local timezone (configured in Docker Compose with TZ).
    converter = time.localtime

    def format(self, record):
        try:
            record.relpath = str(Path(record.pathname).resolve().relative_to(PROJECT_ROOT))
        except Exception:
            record.relpath = record.pathname
        return super().format(record)

class VerboseLogger(logging.Logger):
    """Logger with message-level verbosity filtering."""

    verbosity: int = MAX_VERBOSITY

    def _should_emit(self, message_verbosity: int) -> bool:
        return message_verbosity <= self.verbosity

    def debug(self, msg: str, *args, verbosity: int = 3, **kwargs):
        """Emit debug output only when the message verbosity is at or below the threshold."""
        if self._should_emit(verbosity):
            super().debug(msg, *args, **kwargs)

    def vdebug(self, verbosity: int, msg: str, *args, **kwargs):
        """
        Log debug messages based on verbosity level.
        verbosity=3 prints the most verbose information.
        """
        self.debug(msg, *args, verbosity=verbosity, **kwargs)

# Register our custom logger class with the logging system
logging.setLoggerClass(VerboseLogger)

def setup_logger(
    name: str = "app_logger", 
    log_dir: str = "logs", 
    log_file: str = "app.log",
    max_bytes: int = 5 * 1024 * 1024,  # 5 MB
    backup_count: int = 3,
    verbosity: int = 3
) -> VerboseLogger:
    """
    Configures a logger with simultaneous terminal output and a rotating file.
    
    :param name: Name of the logger instance.
    :param log_dir: Relative folder address for log files.
    :param log_file: Name of the log file.
    :param max_bytes: Maximum size per file before rotating.
    :param backup_count: Number of backup log files to retain.
    :param verbosity: Maximum message verbosity allowed for debug output.
    """
    logger = logging.getLogger(name)
    logger.setLevel(logging.DEBUG)
    logger.verbosity = verbosity
    logger.propagate = False
    
    # Avoid duplicate handlers if setup is called multiple times
    if logger.handlers:
        return logger

    # Common formatting for console and file
    log_format = RelativePathFormatter(
        fmt="%(asctime)s - %(name)s - %(levelname)s - pid=%(process)d - %(relpath)s:%(lineno)d - %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S %Z"
    )

    # --- 1. Terminal (Stream) Handler ---
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(log_format)
    console_handler.setLevel(logging.DEBUG)
    logger.addHandler(console_handler)

    # --- 2. Rotating File Handler with Relative Directory Support ---
    # Resolve relative path safely using pathlib
    relative_path = Path(log_dir)
    relative_path.mkdir(parents=True, exist_ok=True)
    full_log_path = relative_path / log_file

    file_handler = RotatingFileHandler(
        filename=full_log_path,
        maxBytes=max_bytes,
        backupCount=backup_count,
        encoding="utf-8"
    )
    file_handler.setFormatter(log_format)
    file_handler.setLevel(logging.DEBUG)
    logger.addHandler(file_handler)

    return logger



normal_logger = setup_logger(
    name="normal_logger",
    log_dir="logs",
    log_file="normal.log",
    max_bytes=5 * 1024 * 1024,  # 5 MB
    backup_count=3,
    verbosity=MAX_VERBOSITY
)
