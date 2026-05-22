# Security Notes

BKE Layout Preview reads local BKE project files selected by the user and serves project images through a local-only development or Electron HTTP server.

- The server binds to `127.0.0.1`.
- `/api/image` and `/api/source-file` resolve files inside the selected project root.
- Do not publish private game assets, save data, engine binaries, or generated release bundles in the source repository.
- If you find a path traversal or local file exposure issue, please open a private report or contact the maintainer before public disclosure.
