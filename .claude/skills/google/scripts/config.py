"""
Configuration for Google Skills (NotebookLM + Drive)
Centralizes constants, selectors, and paths for all Google services
"""

from pathlib import Path

# Paths - Use shared data directory in Application Support
SKILL_DIR = Path(__file__).parent.parent
SHARED_DATA_DIR = Path.home() / "Library" / "Application Support" / "claude-google-skills"

# Ensure shared directory exists
SHARED_DATA_DIR.mkdir(parents=True, exist_ok=True)

# Shared auth data
DATA_DIR = SHARED_DATA_DIR
BROWSER_STATE_DIR = SHARED_DATA_DIR / "browser_state"
BROWSER_PROFILE_DIR = SHARED_DATA_DIR / "chrome_profile"
STATE_FILE = BROWSER_STATE_DIR / "state.json"
AUTH_INFO_FILE = SHARED_DATA_DIR / "auth_info.json"

# NotebookLM specific
LIBRARY_FILE = SHARED_DATA_DIR / "library.json"

# Google Drive specific
DOWNLOADS_DIR = SHARED_DATA_DIR / "downloads"

# URLs
NOTEBOOKLM_URL = "https://notebooklm.google.com"
DRIVE_URL = "https://drive.google.com/drive/my-drive"
DRIVE_HOME_URL = "https://drive.google.com"

# NotebookLM Selectors
QUERY_INPUT_SELECTORS = [
    "textarea.query-box-input",  # Primary
    'textarea[aria-label="Feld für Anfragen"]',  # Fallback German
    'textarea[aria-label="Input for queries"]',  # Fallback English
]

RESPONSE_SELECTORS = [
    ".to-user-container .message-text-content",  # Primary
    "[data-message-author='bot']",
    "[data-message-author='assistant']",
]

# Google Drive Selectors
FILE_LIST_SELECTORS = [
    '[data-id]',  # File/folder rows have data-id attribute
]

# Browser Configuration
BROWSER_ARGS = [
    '--disable-blink-features=AutomationControlled',
    '--disable-dev-shm-usage',
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check'
]

USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'

# Google Stitch
STITCH_URL = "https://stitch.withgoogle.com/"
STITCH_GENERATION_TIMEOUT = 600  # 10 minutes

# Timeouts
LOGIN_TIMEOUT_MINUTES = 10
QUERY_TIMEOUT_SECONDS = 120
PAGE_LOAD_TIMEOUT = 30000
