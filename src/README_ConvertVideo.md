# ConvertVideoController

**ConvertVideoController** is a Node.js controller class within the **LGS1920/backend** project, designed to handle
video conversion operations using FFmpeg. It provides a RESTful API for converting video files between formats (e.g.,
MP4, WebM, AVI), with real-time progress tracking via Server-Sent Events (SSE) or polling. The associated
`ConvertVideoResource` class defines the API routes for the controller, integrating with a Bun-based web server.

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Usage](#usage)
    - [API Endpoints](#api-endpoints)
    - [Example Request](#example-request)
- [API Reference](#api-reference)
    - [ConvertVideoController Methods](#convertvideocontroller-methods)
    - [ConvertVideoResource Routes](#convertvideoresource-routes)
- [Configuration Options](#configuration-options)
- [Error Handling](#error-handling)
- [Dependencies](#dependencies)
- [Security Considerations](#security-considerations)
- [License](#license)
- [Contact](#contact)

## Features

- **Video Conversion**: Converts video files between formats (MP4, WebM, AVI) using FFmpeg, with support for custom
  codecs, bitrates, resolutions, and frame rates.
- **Real-Time Progress Tracking**: Supports SSE for streaming progress updates or polling for periodic status checks.
- **Metadata Application**: Applies custom metadata (e.g., title, comment) to output videos.
- **Cancellation Support**: Allows clients to cancel ongoing conversions, terminating FFmpeg processes and cleaning up
  resources.
- **Resource Management**: Automatically cleans up temporary files and stale conversions to prevent disk space issues.
- **Robust Error Handling**: Detects and reports errors during file parsing, validation, conversion, and streaming.
- **Asynchronous Processing**: Starts conversions in the background, returning a conversion ID immediately for
  non-blocking operation.
- **Temporary File Handling**: Manages input and output files in the system’s temporary directory, with cleanup after
  download or cancellation.

## Installation

The `ConvertVideoController` and `ConvertVideoResource` classes are part of the LGS1920/backend project and require a
Node.js environment with Bun as the runtime. To set up the backend:

1. **Clone the Repository**:
    - Clone the LGS1920/backend project to your local machine:
      ```bash
      git clone <repository-url>
      cd lgs1920-backend
      ```

2. **Install Dependencies**:
    - Install required Node.js packages, including `bun`, `nanoid`, and FFmpeg:
      ```bash
      bun install nanoid
      ```
    - Ensure FFmpeg and FFprobe are installed on the server:
      ```bash
      # On Ubuntu/Debian
      sudo apt-get update
      sudo apt-get install ffmpeg
      ```
      ```bash
      # On macOS (using Homebrew)
      brew install ffmpeg
      ```

3. **Copy the Files**:
    - Place `ConvertVideoController.js` in the `controllers/` directory and `ConvertVideoResource.js` in the
      `resources/` directory of your project.

4. **Configure Routes**:
    - Ensure the `CONVERT_VIDEO_ROUTE` constant is defined in your project’s `index.js` (e.g., `src/index.js`):
      ```javascript
      export const CONVERT_VIDEO_ROUTE = {
        convert: '/convert',
        progress: '/progress',
        download: '/download',
        cancel: '/cancel'
      }
      ```
    - Initialize the `ConvertVideoResource` in your main application file:
      ```javascript
      import { ConvertVideoResource } from './resources/ConvertVideoResource.js'
 
      const app = Bun.serve() // Your Bun server instance
      new ConvertVideoResource(app)
      ```

5. **Run the Server**:
    - Start the Bun server:
      ```bash
      bun run src/index.js
      ```

## Usage

### API Endpoints

The `ConvertVideoResource` defines the following API endpoints under the `/convert` base path:

- **POST `/convert`**:
    - Initiates a video conversion, accepting a multipart form with a video file and conversion parameters.
    - Returns a conversion ID and URLs for progress tracking, download, and cancellation.
- **GET `/convert/progress/:id`**:
    - Retrieves conversion progress, either as an SSE stream (`?sse=true`) or a JSON response (`?sse=false`).
    - Optional query parameter: `debug=true` for verbose logging.
- **GET `/convert/download/:id`**:
    - Downloads the converted video file as a stream.
- **DELETE `/convert/cancel/:id`**:
    - Cancels an ongoing conversion, terminates the FFmpeg process, and cleans up resources.

### Example Request

Initiate a video conversion from WebM to MP4 using `curl`:

```bash
curl -X POST http://localhost:3333/convert \
  -F "file=@input.webm" \
  -F "body={\"from\":\"WEBM\",\"to\":\"MP4\",\"params\":[\"-c:v\",\"libx264\",\"-c:a\",\"aac\"],\"metadata\":{\"title\":\"My Video\"}}" \
  -H "X-Request-Progress: true" \
  -H "X-Progress-Interval: 500"
```

Response:

```json
{
  "success": true,
  "conversionId": "abc123",
  "message": "Conversion started successfully",
  "urls": {
    "progress": "/convert/progress/abc123",
    "download": "/convert/download/abc123",
    "cancel": "/convert/cancel/abc123"
  },
  "metadata": {
    "timestamp": "2025-08-08T10:04:00.000Z",
    "originalFilename": "input.webm",
    "targetFormat": "MP4",
    "estimatedDuration": "unknown"
  }
}
```

Monitor progress via SSE:

```bash
curl http://localhost:3333/convert/progress/abc123?sse=true
```

Example SSE output:

```
event: start
data: {"started":true,"conversionId":"abc123","percentage":0,"timeSec":0}

event: progress
data: {"percentage":50.00,"timeSec":10.00}

event: complete
data: {"done":true,"percentage":100,"timeSec":20.00}
```

Download the converted file:

```bash
curl -o output.mp4 http://localhost:3333/convert/download/abc123
```

Cancel the conversion:

```bash
curl -X DELETE http://localhost:3333/convert/cancel/abc123
```

## API Reference

### ConvertVideoController Methods

1. **`convertVideo({ request, set })`**:
    - Initiates a video conversion asynchronously.
    - Parameters:
        - `request`: HTTP request object with multipart form data.
        - `set`: Response headers object.
    - Returns: `Promise<Response>` with conversion ID, URLs, and metadata.
    - Throws: Errors for invalid requests or file issues.

2. **`downloadConvertedFile({ params, set })`**:
    - Streams the converted video file for download.
    - Parameters:
        - `params.id`: Conversion ID.
        - `set`: Response headers object.
    - Returns: `Promise<Response>` with file stream or error.
    - Throws: Errors for missing conversions or files.

3. **`cancelConversion({ params, set })`**:
    - Cancels an ongoing conversion and cleans up resources.
    - Parameters:
        - `params.id`: Conversion ID.
        - `set`: Response headers object.
    - Returns: `Promise<Response>` with cancellation status.
    - Throws: Errors for missing conversions or cleanup failures.

4. **`startProgressStream({ request, params, set })`**:
    - Provides conversion progress via SSE or polling.
    - Parameters:
        - `request`: HTTP request object with query parameters (`sse`, `debug`).
        - `params.id`: Conversion ID.
        - `set`: Response headers object.
    - Returns: `Promise<Response>` with SSE stream or JSON progress data.
    - Throws: Errors for missing conversions.

### ConvertVideoResource Routes

- **`POST /convert`**:
    - Bound to `controller.convertVideo`.
- **`GET /convert/progress/:id`**:
    - Bound to `controller.startProgressStream`.
- **`GET /convert/download/:id`**:
    - Bound to `controller.downloadConvertedFile`.
- **`DELETE /convert/cancel/:id`**:
    - Bound to `controller.cancelConversion`.

## Configuration Options

- **Request Body for `POST /convert`**:
    - `file`: Video file (`File` or file path as string).
    - `body`: JSON object with:
        - `from`: Input format (e.g., `WEBM`, `MP4`).
        - `to`: Output format (e.g., `MP4`, `WEBM`, `AVI`).
        - `params`: Array of FFmpeg arguments (optional).
        - `duration`: Video duration in milliseconds (optional).
        - `metadata`: Key-value pairs for video metadata (optional).
        - `verbose`: Boolean for verbose logging (optional).
    - Example:
      ```json
      {
        "from": "WEBM",
        "to": "MP4",
        "params": ["-c:v", "libx264", "-c:a", "aac"],
        "metadata": { "title": "My Video" },
        "duration": 30000,
        "verbose": true
      }
      ```

- **Query Parameters for `GET /convert/progress/:id`**:
    - `sse`: Boolean (`true` for SSE, `false` for polling).
    - `debug`: Boolean for verbose logging.

- **Environment Configuration**:
    - Ensure `CONVERT_VIDEO_ROUTE` is defined in `index.js` with correct route paths.
    - Temporary files are stored in the system’s `tmpdir()` (e.g., `/tmp` on Linux).

## Error Handling

The controller logs errors and returns appropriate HTTP status codes:

- **400**: Invalid request data (e.g., missing file or body).
- **404**: Conversion ID not found.
- **500**: Server errors (e.g., file not found, FFmpeg failure).
- **202**: Conversion in progress (for premature download attempts).

Example error response:

```json
{
  "success": false,
  "error": "Invalid request data"
}
```

Errors are logged with an `[ERROR]` prefix, and verbose logs are enabled with `verbose=true` in the request body or
`debug=true` in query parameters.

## Dependencies

- **Bun**: Runtime for Node.js, used for spawning FFmpeg and handling HTTP requests.
- **nanoid**: Generates unique conversion IDs.
- **FFmpeg/FFprobe**: Required for video conversion and metadata extraction.
    - Install via system package manager (e.g., `apt`, `brew`).
- **Node.js Modules**: Uses built-in `node:path`, `node:os`, `node:fs/promises`.

## Security Considerations

- **File Path Sanitization**: File paths are generated using `tmpdir()` and `nanoid` to prevent path traversal attacks.
- **Metadata Sanitization**: Metadata keys and values are sanitized to prevent command injection in FFmpeg arguments.
- **Temporary File Cleanup**: Ensures temporary files are deleted after conversion, download, or cancellation to prevent
  disk space exhaustion.
- **Process Termination**: FFmpeg processes are gracefully terminated on cancellation, with a fallback to force-kill if
  needed.
- **Resource Limits**: Consider implementing rate limiting or file size restrictions to prevent abuse (not included in
  the current code).

## License

Copyright © 2025 LGS1920. All rights reserved.

This software is proprietary and may not be copied, modified, or distributed without permission from LGS1920.

## Contact

- **Email**: [contact@lgs1920.fr](mailto:contact@lgs1920.fr)
- **Team**: LGS1920 Team
- **Project**: LGS1920/backend

For support or inquiries, please contact the LGS1920 team via email.