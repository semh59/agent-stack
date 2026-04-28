#!/usr/bin/env python3
import subprocess
import sys
import logging

logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger("bootstrap")

def run_command(cmd: list[str]):
    try:
        subprocess.check_call(cmd)
    except subprocess.CalledProcessError as e:
        logger.error(f"Command failed: {' '.join(cmd)}")
        sys.exit(1)

def main():
    logger.info("Initializing Alloy AI Environment...")

    # 1. Download spaCy model
    logger.info("Downloading spaCy model: en_core_web_sm...")
    run_command([sys.executable, "-m", "spacy", "download", "en_core_web_sm"])

    # 2. Check for other essential resources
    logger.info("Verifying environment...")
    # Add future checks here (e.g., LanceDB path creation, etc.)

    logger.info("Environment bootstrap complete!")

if __name__ == "__main__":
    main()
