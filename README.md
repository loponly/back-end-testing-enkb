# back-end-testing-enkb

A Firebase-based backend testing project with Cloud Functions.

## Setup

### Prerequisites
- Node.js (v14 or later)
- Firebase CLI
- Google Cloud Service Account credentials

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/loponly/back-end-testing-enkb.git
   cd back-end-testing-enkb
   ```

2. Install dependencies:
   ```bash
   cd functions
   npm install
   ```

3. Set up Firebase Service Account:
   - Create a service account in the Google Cloud Console
   - Download the service account key JSON file
   - Rename it to `serviceAccount.json` and place it in the root directory
   - Use `serviceAccount.json.example` as a reference for the required structure

### Running the Project

1. Start the Firebase emulators:
   ```bash
   firebase emulators:start
   ```

2. Deploy to Firebase (production):
   ```bash
   firebase deploy
   ```

### Security Notes

- Never commit `serviceAccount.json` to version control
- The file is already added to `.gitignore` for security
- Use environment variables in production environments when possible

## Project Structure

- `functions/` - Firebase Cloud Functions
- `src/` - Source code
- `tests/` - Test files
- `serviceAccount.json.example` - Template for service account configuration